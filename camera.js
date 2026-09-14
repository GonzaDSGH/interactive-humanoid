'use strict';

/* ==================================================================
   camera.js — device enumeration, acquisition and error handling.

   p5's createCapture() owns the live element; a getUserMedia probe runs
   first so that failures can be classified (p5 swallows those errors)
   and so that unsupported constraints can be relaxed before capturing.
   The raw element is hidden immediately: it is a data source, never an
   image in the artwork.
   ================================================================== */

const CameraManager = {
  capture: null,
  devices: [],
  deviceId: null,
  label: '',
  width: 0,
  height: 0,
  frameRate: 0,
  ready: false,
  lastError: null,
  onLost: null,
  _pollTimer: null,

  supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  },

  secureContextHint() {
    if (window.isSecureContext) return '';
    return 'The camera API needs a secure context. Serve the project over http://localhost or https:// instead of opening the file directly.';
  },

  /* One permission request, so that enumerateDevices() returns real labels. */
  async requestPermission() {
    if (!this.supported()) {
      throw this._describe(new DOMException('getUserMedia unavailable', 'NotSupportedError'));
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (err) {
      throw this._describe(err);
    }
    stream.getTracks().forEach((t) => t.stop());
    await this._wait(CONFIG.camera.restartDelayMs);
  },

  async listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    return this.devices;
  },

  describeDevices() {
    if (!this.devices.length) return 'no videoinput devices reported';
    return this.devices
      .map((d, i) => `${i + 1}. ${d.label}  [${d.deviceId ? d.deviceId.slice(0, 12) + '…' : 'no id'}]`)
      .join('\n');
  },

  /* Candidate constraint sets, from most specific to most forgiving, so a
     virtual camera (DroidCam, OBS, …) that rejects a resolution still opens. */
  _candidates(deviceId) {
    const size = {
      width: { ideal: CONFIG.camera.idealWidth },
      height: { ideal: CONFIG.camera.idealHeight },
      frameRate: { ideal: CONFIG.camera.idealFrameRate }
    };
    const list = [];
    if (deviceId) {
      list.push({ video: Object.assign({ deviceId: { exact: deviceId } }, size), audio: false });
      list.push({ video: { deviceId: { exact: deviceId } }, audio: false });
      list.push({ video: { deviceId: { ideal: deviceId } }, audio: false });
    }
    list.push({ video: size, audio: false });
    list.push({ video: true, audio: false });
    return list;
  },

  async start(deviceId) {
    this.stop();
    this.lastError = null;
    this.ready = false;

    if (!this.supported()) {
      throw this._describe(new DOMException('getUserMedia unavailable', 'NotSupportedError'));
    }

    /* 1. probe — classify errors and settle on constraints the device accepts */
    let constraints = null;
    let probeError = null;
    for (const candidate of this._candidates(deviceId)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(candidate);
        stream.getTracks().forEach((t) => t.stop());
        constraints = candidate;
        break;
      } catch (err) {
        probeError = err;
        /* a busy or missing device will not be fixed by relaxing constraints */
        if (err && (err.name === 'NotAllowedError' || err.name === 'NotReadableError')) break;
      }
    }
    if (!constraints) throw this._describe(probeError);

    await this._wait(CONFIG.camera.restartDelayMs);

    /* 2. p5 owns the live capture element */
    const capture = createCapture(constraints);
    capture.elt.setAttribute('playsinline', '');
    capture.elt.muted = true;
    capture.hide(); // the webcam image itself must never be visible
    this.capture = capture;

    /* 3. wait for real frames, never an endless spinner */
    try {
      await this._waitForFrames(capture, CONFIG.camera.readyTimeoutMs);
    } catch (err) {
      this.stop();
      throw err;
    }

    const track = this._track();
    const settings = track ? track.getSettings() : {};
    this.deviceId = settings.deviceId || deviceId || null;
    this.width = capture.elt.videoWidth;
    this.height = capture.elt.videoHeight;
    this.frameRate = Math.round(settings.frameRate || 0);
    const known = this.devices.find((d) => d.deviceId === this.deviceId);
    this.label = (track && track.label) || (known && known.label) || 'camera';
    this.ready = true;

    if (track) {
      track.addEventListener('ended', () => {
        this.ready = false;
        if (typeof this.onLost === 'function') {
          this.onLost({
            title: 'Camera disconnected',
            message: `The stream from "${this.label}" ended. The device was unplugged, or a virtual camera was stopped.`,
            hint: 'Reconnect the camera and retry.',
            name: 'Disconnected'
          });
        }
      });
    }
    return true;
  },

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this.capture) {
      const el = this.capture.elt;
      if (el && el.srcObject) el.srcObject.getTracks().forEach((t) => t.stop());
      this.capture.remove();
      this.capture = null;
    }
    this.ready = false;
  },

  _track() {
    const el = this.capture && this.capture.elt;
    if (!el || !el.srcObject) return null;
    return el.srcObject.getVideoTracks()[0] || null;
  },

  _waitForFrames(capture, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        const el = capture.elt;
        const hasFrames = el && el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0;
        if (hasFrames) {
          clearInterval(this._pollTimer);
          this._pollTimer = null;
          resolve(true);
          return;
        }
        if (performance.now() - started > timeoutMs) {
          clearInterval(this._pollTimer);
          this._pollTimer = null;
          reject({
            name: 'NoFrames',
            title: 'Camera produced no video',
            message: 'The device opened but never delivered a frame. It is usually held by another application, or a virtual camera is not currently transmitting.',
            hint: 'Close other apps using the camera (or start streaming in DroidCam/OBS) and retry.'
          });
        }
      };
      this._pollTimer = setInterval(check, 120);
      check();
    });
  },

  _wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  /* Map DOMException names to something a developer can act on. */
  _describe(err) {
    const name = (err && err.name) || 'Error';
    const secure = this.secureContextHint();
    const table = {
      NotAllowedError: {
        title: 'Camera permission denied',
        message: 'The browser blocked access to the camera for this page.',
        hint: 'Allow the camera in the site permissions (padlock icon) and retry.'
      },
      PermissionDeniedError: {
        title: 'Camera permission denied',
        message: 'The browser blocked access to the camera for this page.',
        hint: 'Allow the camera in the site permissions and retry.'
      },
      NotFoundError: {
        title: 'No camera found',
        message: 'No video input device is available to the browser.',
        hint: 'Connect a webcam, or start your virtual camera (DroidCam, OBS) before loading the page.'
      },
      DevicesNotFoundError: {
        title: 'No camera found',
        message: 'No video input device is available to the browser.',
        hint: 'Connect a webcam or start your virtual camera, then retry.'
      },
      NotReadableError: {
        title: 'Camera busy',
        message: 'The device exists but the system refused to hand over the video stream. Another application is most likely using it.',
        hint: 'Close video calls, recorders or other browser tabs holding the camera and retry.'
      },
      TrackStartError: {
        title: 'Camera busy',
        message: 'The camera could not be started; it is probably in use elsewhere.',
        hint: 'Close the other application and retry.'
      },
      OverconstrainedError: {
        title: 'Camera constraints unsupported',
        message: `The selected device rejected the requested settings (${(err && err.constraint) || 'unknown constraint'}).`,
        hint: 'Pick another camera, or lower the requested resolution in config.js.'
      },
      AbortError: {
        title: 'Camera aborted',
        message: 'The operating system interrupted the camera while starting it.',
        hint: 'Retry; if it persists, reconnect the device.'
      },
      SecurityError: {
        title: 'Camera blocked by security policy',
        message: 'This context is not allowed to open a camera.',
        hint: secure || 'Serve the page over https:// or http://localhost.'
      },
      NotSupportedError: {
        title: 'Camera API unavailable',
        message: 'navigator.mediaDevices.getUserMedia is not exposed in this context.',
        hint: secure || 'Use a recent Chrome/Edge/Firefox build over localhost or https.'
      },
      TypeError: {
        title: 'Invalid camera request',
        message: 'The media constraints were rejected by the browser.',
        hint: secure || 'Reload the page; if it persists, report the console output.'
      }
    };
    const info = table[name] || {
      title: 'Camera initialisation failed',
      message: (err && err.message) || String(err),
      hint: secure || 'Check the browser console for the full error.'
    };
    return Object.assign({ name }, info);
  }
};
