// Auto-match recorder (AudioWorklet): passes each mic block on with the context time it was processed.
class GmRecorder extends AudioWorkletProcessor{process(inputs){const c=inputs[0]&&inputs[0][0];if(c&&c.length)this.port.postMessage({t:currentTime,d:c.slice(0)});return true;}}
registerProcessor('gm-recorder',GmRecorder);
