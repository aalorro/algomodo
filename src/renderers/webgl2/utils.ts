// WebGL2 Rendering utilities

export function createShader(gl: WebGL2RenderingContext, source: string, type: number): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation error: ${error}`);
  }
  
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program linking error: ${error}`);
  }
  
  return program;
}

export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  data?: Uint8Array | Uint32Array | Float32Array
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');
  
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  
  const format = data instanceof Float32Array ? gl.RGBA : gl.RGBA;
  const type = data instanceof Float32Array ? gl.FLOAT : gl.UNSIGNED_BYTE;
  
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    format,
    width,
    height,
    0,
    format,
    type,
    data || null
  );
  
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

export function createFramebuffer(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture
): WebGLFramebuffer {
  const fb = gl.createFramebuffer();
  if (!fb) throw new Error('Failed to create framebuffer');
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: ${status}`);
  }
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fb;
}

export function setUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniforms: Record<string, any>
) {
  gl.useProgram(program);
  
  for (const [name, value] of Object.entries(uniforms)) {
    const location = gl.getUniformLocation(program, name);
    if (!location) continue;
    
    if (typeof value === 'number') {
      gl.uniform1f(location, value);
    } else if (Array.isArray(value)) {
      if (value.length === 2) gl.uniform2fv(location, value);
      else if (value.length === 3) gl.uniform3fv(location, value);
      else if (value.length === 4) gl.uniform4fv(location, value);
    }
  }
}

export function hexToVec4(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, 1.0];
}

export function createQuadVAO(gl: WebGL2RenderingContext, program: WebGLProgram): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Failed to create VAO');
  
  gl.bindVertexArray(vao);
  
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]), gl.STATIC_DRAW);
  
  const positionLoc = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
  
  gl.bindVertexArray(null);
  return vao;
}

export function drawFullscreenQuad(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject,
  width: number,
  height: number
) {
  gl.viewport(0, 0, width, height);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
