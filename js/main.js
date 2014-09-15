(function () {
  var video = document.querySelector('video');
  var gif = null;
  var trackingTask = null;
  var lastGif = null;

  var flameFrames = [];
  var flames = [];

  var pictureWidth = 240;
  var pictureHeight = 180;

  //load all flame animation frames
  function loadImages() {
    var promises = [];

    for (var i = 1; i < 14; i++) {
      var deferred = new $.Deferred();
      var img = new Image();

      img.onload = deferred.resolve;
      img.src = "img/flame/" + i + ".png";

      flameFrames.push(img);
      promises.push(deferred.promise());
    }

    return $.when.apply($, promises);
  }

  function checkRequirements() {
    var deferred = new $.Deferred();

    //camera access
    if (!Modernizr.getusermedia) {
      deferred.reject('Your browser doesn\'t support getUserMedia (according to Modernizr).');
    }
    //web workers, typed arrays and file API are required by gif.js
    if (!Modernizr.webworkers) {
      deferred.reject('Your browser doesn\'t support web workers (according to Modernizr).');
    }
    if (!Modernizr.filereader) {
      deferred.reject('Your browser doesn\'t support File API (according to Modernizr).');
    }
    if (!Modernizr.typedarrays) {
      deferred.reject('Your browser doesn\'t support typed arrays (according to Modernizr).');
    }

    deferred.resolve();

    return deferred.promise();
  }

  function searchForFrontCamera() {
    var deferred = new $.Deferred();

    //MediaStreamTrack.getSources seems to be supported only by Chrome
    if (MediaStreamTrack && MediaStreamTrack.getSources) {
      MediaStreamTrack.getSources(function (sources) {
        var rearCameraIds = sources.filter(function (source) {
          return (source.kind === 'video' && source.facing === 'user');
        }).map(function (source) {
          return source.id;
        });

        if (rearCameraIds.length) {
          deferred.resolve(rearCameraIds[0]);
        } else {
          deferred.resolve(null);
        }
      });
    } else {
      deferred.resolve(null);
    }

    return deferred.promise();
  }

  function setupVideo(frontCameraId) {
    var deferred = new $.Deferred();
    var getUserMedia = Modernizr.prefixed('getUserMedia', navigator);
    var videoSettings = {
      video: {
        optional: [
          {
            width: {max: pictureWidth}
          },
          {
            height: {max: pictureHeight}
          }
        ]
      }
    };

    //if front camera is available - use it
    if (frontCameraId) {
      videoSettings.video.optional.push({
        sourceId: frontCameraId
      });
    }

    getUserMedia(videoSettings, function (stream) {
      //Setup the video stream
      video.src = window.URL.createObjectURL(stream);

      window.stream = stream;

      video.addEventListener("loadedmetadata", function (e) {
        //get video width and height as it might be different than we requested
        pictureWidth = this.videoWidth;
        pictureHeight = this.videoHeight;

        if (!pictureWidth && !pictureHeight) {
          //firefox fails to deliver info about video size on time (issue #926753), we have to wait
          var waitingForSize = setInterval(function () {
            if (video.videoWidth && video.videoHeight) {
              pictureWidth = video.videoWidth;
              pictureHeight = video.videoHeight;

              clearInterval(waitingForSize);
              deferred.resolve();
            }
          }, 100);
        } else {
          deferred.resolve();
        }
      }, false);
    }, function () {
      deferred.reject('There is no access to your camera, have you denied it?');
    });

    return deferred.promise();
  }

  function step1() {
    var waitForImages = loadImages();

    checkRequirements()
      .then(searchForFrontCamera)
      .then(setupVideo)
      .then(waitForImages)
      .done(function () {
        //Enable 'record' button
        $('#record').removeAttr('disabled');
        //Hide the 'enable the camera' info
        $('#step1 figure').removeClass('not-ready');

        setupTrackingJS();
      })
      .fail(function (error) {
        showError(error);
      });
  }

  function setupTrackingJS() {
    var canvas = document.querySelector('#step1 canvas.visible');
    var scaledWidth = 240, scaledHeight = Math.round((scaledWidth / pictureWidth) * pictureHeight);
    var frameCount = 0;

    //setup canvas
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;

    var ctx = canvas.getContext('2d');

    var tracker = new tracking.ObjectTracker('face');
    tracker.setInitialScale(4);
    tracker.setStepSize(2);
    tracker.setEdgesDensity(0.1);

    trackingTask = tracking.track('#step1 video', tracker);

    tracker.on('track', function (event) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      flames = [];

      event.data.forEach(function (rect) {
        frameCount++;
        var orgWidth = 256;
        var orgHeight = 256;
        var newWidth = (rect.width * 2);
        var newHeight = newWidth / orgWidth * orgHeight;
        var fixTop = rect.height * 0.2;
        var fixLeft = -rect.width / 2;
        var image = flameFrames[frameCount % flameFrames.length];

        flames.push({
          image: image,
          x: (rect.x + fixLeft),
          y: (rect.y - newHeight + fixTop),
          width: newWidth,
          height: newHeight
        });

        ctx.drawImage(image, (rect.x + fixLeft), (rect.y - newHeight + fixTop), newWidth, newHeight);
      });
    });
  }

  function startRecording() {
    var canvas = document.querySelector('#step1 canvas.hidden');
    var scaledWidth = 240, scaledHeight = Math.round((scaledWidth / pictureWidth) * pictureHeight);

    //setup canvas
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;

    var ctx = canvas.getContext('2d');

    //setup gif.js
    gif = new GIF({
      workers: 4,
      quality: 10,
      workerScript: 'js/vendor/gif.worker.js',
      width: scaledWidth,
      height: scaledHeight
    });

    //try to dump a frame every 100ms
    var interval = 100, ticks = 3500 / interval, lastFrameTime = Date.now();
    var timer = setInterval(function () {
      ticks--;
      if (ticks <= 0) {
        //stop recording
        clearInterval(timer);
        //enable 'record' button
        $('#record').text('Record').removeAttr('disabled');
        //enable 'convert to gif' button
        $('#convert').removeAttr('disabled');
        //hide recording indicator
        $('#step1 figure').removeClass('recording');

        return;
      }

      $('#record').text(ticks);

      ctx.drawImage(video, 0, 0, scaledWidth, scaledHeight);
      if (flames) {
        flames.forEach(function (flame) {
          ctx.drawImage(flame.image, flame.x, flame.y, flame.width, flame.height);
        });
      }

      gif.addFrame(ctx, {copy: true, delay: (Date.now() - lastFrameTime)});
      lastFrameTime = Date.now();
    }, interval);

    //block record button
    $('#record').attr('disabled', 'disabled');
    //block 'convert to gif' button
    $('#convert').attr('disabled', 'disabled');
    //show recording indicator
    $('#step1 figure').addClass('recording');
  }

  function step2() {
    var outputImg = $('#step2 figure img');
    var startTime;

    if (!gif.running) {
      //hide previous image
      outputImg.removeAttr('src');
      //block 'send to imgur' button
      $('#upload').attr('disabled', 'disabled');
      //show image placeholder
      $('#step2 figure').addClass('loading');

      gif.on('start', function () {
        $('#conversionResult').text('Working...');
        return startTime = Date.now();
      });
      gif.on('progress', function (p) {
        $('#progressbar').css('width', (Math.round(p * 100)) + "%")
      });
      gif.on('finished', function (blob) {
        lastGif = blob;
        outputImg.attr('src', URL.createObjectURL(blob));

        var time = (((Date.now() - startTime) / 1000).toFixed(2));
        var size = ((blob.size / 1000).toFixed(2));

        $('#conversionResult').html('Converted in <strong>' + time + '</strong>sec. Image size is <strong>' + size + '</strong>KB.');

        //enable 'send to imgur' button
        $('#upload').removeAttr('disabled');
        //hide image placeholder
        $('#step2 figure').removeClass('loading');
      });

      gif.render();
    }
  }

  function step3() {
    var clientId = '0be7cbc22f0ebb3';

    $('#step3 blockquote p').text('Sending ...');

    //we are converting blob to a base64 string
    var reader = new window.FileReader();
    reader.readAsDataURL(lastGif);
    reader.onloadend = function () {
      //sending data to Imgur
      $.ajax({
        url: 'https://api.imgur.com/3/image',
        method: 'POST',
        headers: {
          Authorization: 'Client-ID ' + clientId,
          Accept: 'application/json'
        },
        data: {
          image: (reader.result).replace('data:image/gif;base64,', ''),
          type: 'base64',
          description: 'Created with http://kdzwinel.github.io/JS-face-tracking-demo/'
        },
        success: function (result) {
          var id = result.data.id;
          $('#step3 img').attr('src', 'https://imgur.com/' + id + '.gif');

          var url = 'https://imgur.com/' + id;
          $('#step3 blockquote p').html('Done! Your GIF is available here: <a href="' + url + '" target="_blank">' + url + "</a>");
        },
        error: function (xhr, type, message) {
          showError('Upload failed! Error: "' + message + '".');
        }
      });
    }
  }

  /*********************************
   * UI Stuff
   *********************************/

    //start step1 immediately
  step1();
  $('.help').popover();

  function changeStep(step) {
    if (step === 1) {
      video.play();
      trackingTask.run();
    } else {
      video.pause();
      trackingTask.stop();
    }

    hideError();
    $('body').attr('class', 'step' + step);
    $('.nav li.active').removeClass('active');
    $('.nav li:eq(' + (step - 1) + ')').removeClass('disabled').addClass('active');
  }

  function showError(text) {
    $('.alert').show().find('span').text(text);
  }

  function hideError() {
    $('.alert').hide();
  }

  $('#convert').click(function () {
    step2();
    changeStep(2);
  });

  $('#upload').click(function () {
    step3();
    changeStep(3);
  });

  $('#record').click(startRecording);

  $('.start-over').click(function () {
    changeStep(1);
  });

  $('.nav').on('click', 'a', function () {
    if (!$(this).parent().is('.disabled')) {
      var step = $(this).data('step');
      changeStep(step);
    }

    return false;
  });
})();
