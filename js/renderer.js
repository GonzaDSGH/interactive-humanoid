import { perspective, translation } from './mat4.js';
import { ANATOMY_VERT, ANATOMY_FRAG, FIELD_VERT, FIELD_FRAG } from './shaders.js';

// Rotation pivot: base of skull / head-neck junction, not the chest.
export const PIVOT = [0, -1.4, -0.05];

const TARGET_Y = -0.6;
const HALF_H_TARGET = 1.7;
const FOV_Y = (34 * Math.PI) / 180;
const MARGIN = 1.15;

function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile error: ' + log);
  }
  return shader;
}

function linkProgram(gl, vertSrc, fragSrc) {
  const program = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link error: ' + log);
  }
  return program;
}

function makeBuffer(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

function attribLoc(gl, program, name) {
  return gl.getAttribLocation(program, name);
}
function uniformLoc(gl, program, name) {
  return gl.getUniformLocation(program, name);
}

export class ParticleRenderer {
  constructor(gl) {
    this.gl = gl;
    this.anatomyProgram = linkProgram(gl, ANATOMY_VERT, ANATOMY_FRAG);
    this.fieldProgram = linkProgram(gl, FIELD_VERT, FIELD_FRAG);
    this.proj = perspective(FOV_Y, 1, 0.1, 60);
    this.view = translation(0, -TARGET_Y, -6.5);
    this.camDist = 6.5;
  }

  setAnatomyData(data) {
    const gl = this.gl;
    this.anatomyCount = data.count;
    this.aBasePos = makeBuffer(gl, data.basePos);
    this.aNormal = makeBuffer(gl, data.normal);
    this.aInfluence = makeBuffer(gl, data.influence);
    this.aAttribsBuf = makeBuffer(gl, data.attribs);
    this.aExtraBuf = makeBuffer(gl, data.extra);
  }

  setFieldData(data) {
    const gl = this.gl;
    this.fieldCount = data.count;
    this.fBasePos = makeBuffer(gl, data.basePos);
    this.fAmp = makeBuffer(gl, data.amp);
    this.fAttribs = makeBuffer(gl, data.attribs);
  }

  resize(width, height) {
    const aspect = width / height;
    const halfV = 1.95 * MARGIN;
    const distV = halfV / Math.tan(FOV_Y / 2);
    const distH = (HALF_H_TARGET * MARGIN) / (Math.tan(FOV_Y / 2) * aspect);
    this.camDist = Math.max(distV, distH);
    this.proj = perspective(FOV_Y, aspect, 0.1, 60);
    this.view = translation(0, -TARGET_Y, -this.camDist);
  }

  draw(state) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    this._drawField(state);
    this._drawAnatomy(state);
  }

  _drawAnatomy(state) {
    const gl = this.gl;
    const p = this.anatomyProgram;
    gl.useProgram(p);

    this._bindAttrib(p, 'aBasePos', this.aBasePos, 3);
    this._bindAttrib(p, 'aNormal', this.aNormal, 3);
    this._bindAttrib(p, 'aInfluence', this.aInfluence, 3);
    this._bindAttrib(p, 'aAttribs', this.aAttribsBuf, 4);
    this._bindAttrib(p, 'aExtra', this.aExtraBuf, 2);

    gl.uniformMatrix4fv(uniformLoc(gl, p, 'uProj'), false, this.proj);
    gl.uniformMatrix4fv(uniformLoc(gl, p, 'uView'), false, this.view);
    gl.uniform3fv(uniformLoc(gl, p, 'uPivot'), PIVOT);
    gl.uniform2fv(uniformLoc(gl, p, 'uGazeAngle'), state.gazeAngle);
    gl.uniform2fv(uniformLoc(gl, p, 'uHeadAngle'), state.headAngle);
    gl.uniform2fv(uniformLoc(gl, p, 'uNeckAngle'), state.neckAngle);
    gl.uniform1f(uniformLoc(gl, p, 'uTime'), state.time);
    gl.uniform1f(uniformLoc(gl, p, 'uMicEnergy'), state.micEnergy);
    gl.uniform1f(uniformLoc(gl, p, 'uPixelDensity'), state.pixelDensity);
    gl.uniform3fv(uniformLoc(gl, p, 'uColorCool'), [0.3, 0.8, 1.0]);
    gl.uniform3fv(uniformLoc(gl, p, 'uColorWarm'), [1.0, 0.8, 0.55]);
    gl.uniform3fv(uniformLoc(gl, p, 'uLightDir'), [0.15, 0.4, 0.9]);

    gl.drawArrays(gl.POINTS, 0, this.anatomyCount);
  }

  _drawField(state) {
    const gl = this.gl;
    const p = this.fieldProgram;
    gl.useProgram(p);

    this._bindAttrib(p, 'aBasePos', this.fBasePos, 3);
    this._bindAttrib(p, 'aAmp', this.fAmp, 3);
    this._bindAttrib(p, 'aAttribs', this.fAttribs, 4);

    gl.uniformMatrix4fv(uniformLoc(gl, p, 'uProj'), false, this.proj);
    gl.uniformMatrix4fv(uniformLoc(gl, p, 'uView'), false, this.view);
    gl.uniform1f(uniformLoc(gl, p, 'uTime'), state.time);
    gl.uniform1f(uniformLoc(gl, p, 'uMicEnergy'), state.micEnergy);
    gl.uniform2fv(uniformLoc(gl, p, 'uParallax'), state.parallax);
    gl.uniform1f(uniformLoc(gl, p, 'uPixelDensity'), state.pixelDensity);
    gl.uniform3fv(uniformLoc(gl, p, 'uFieldColor'), [0.3, 0.7, 0.95]);

    gl.drawArrays(gl.POINTS, 0, this.fieldCount);
  }

  _bindAttrib(program, name, buffer, size) {
    const gl = this.gl;
    const loc = attribLoc(gl, program, name);
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
}
