// Minimal AudioWorklet processor to forward mono Float32 frames to the main thread
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs && inputs[0];
    if (input && input[0] && input[0].length) {
      // Copy the buffer to avoid sharing the audio thread's memory
      const copy = new Float32Array(input[0].length);
      copy.set(input[0]);
      this.port.postMessage(copy);
    }
    return true; // keep processor alive
  }
}

registerProcessor('pcm-processor', PCMProcessor);