import { extractPaletteSync, type ExtractOptions, type ExtractResult } from './paletteQuantize';

export type ExtractRequest = { id: number; data: Uint8ClampedArray; width: number; height: number; opts: ExtractOptions };
export type ExtractResponse = { id: number; result: ExtractResult } | { id: number; error: string };

self.onmessage = (event: MessageEvent<ExtractRequest>) => {
  const { id, data, width, height, opts } = event.data;
  let response: ExtractResponse;
  try {
    response = { id, result: extractPaletteSync({ data, width, height }, opts) };
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
