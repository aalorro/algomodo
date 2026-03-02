import type { WebGPUCapabilities } from '../../types';

declare global {
  interface Navigator {
    gpu?: any;
  }
  const GPUBufferUsage: any;
  const GPUMapMode: any;
}

let cachedCapabilities: WebGPUCapabilities | null = null;
let capabilitiesPromise: Promise<WebGPUCapabilities> | null = null;

export async function detectWebGPU(): Promise<WebGPUCapabilities> {
  if (cachedCapabilities !== null) {
    return cachedCapabilities;
  }

  if (capabilitiesPromise) {
    return capabilitiesPromise;
  }

  capabilitiesPromise = initWebGPU();
  cachedCapabilities = await capabilitiesPromise;
  return cachedCapabilities;
}

async function initWebGPU(): Promise<WebGPUCapabilities> {
  try {
    if (!navigator.gpu) {
      return {
        supported: false,
        errorMessage: 'WebGPU is not available on this browser',
      };
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        errorMessage: 'No WebGPU adapter available on this device',
      };
    }

    const device = await adapter.requestDevice();
    
    return {
      supported: true,
      device,
      adapter,
    };
  } catch (error) {
    return {
      supported: false,
      errorMessage: `WebGPU initialization failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function resetWebGPUCapabilities() {
  cachedCapabilities = null;
  capabilitiesPromise = null;
}

export async function createComputeShader(
  device: any,
  code: string
): Promise<any> {
  const shaderModule = device.createShaderModule({ code });
  
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });

  return pipeline;
}

export function createStorageBuffer(
  device: any,
  data: Float32Array | Uint32Array,
  label?: string
): any {
  return device.createBuffer({
    label,
    size: data.byteLength,
    mappedAtCreation: true,
    usage: (GPUBufferUsage as any).STORAGE | (GPUBufferUsage as any).COPY_SRC | (GPUBufferUsage as any).COPY_DST,
    mappedAtCreationBuffer: new ArrayBuffer(data.byteLength),
  });
}

export async function readBuffer(
  device: any,
  buffer: any,
  size: number
): Promise<ArrayBuffer> {
  const stagingBuffer = device.createBuffer({
    size,
    usage: (GPUBufferUsage as any).COPY_DST | (GPUBufferUsage as any).MAP_READ,
  });

  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyBufferToBuffer(buffer, 0, stagingBuffer, 0, size);
  device.queue.submit([commandEncoder.finish()]);

  await stagingBuffer.mapAsync((GPUMapMode as any).READ);
  const result = stagingBuffer.getMappedRange().slice(0);
  stagingBuffer.unmap();

  return result;
}
