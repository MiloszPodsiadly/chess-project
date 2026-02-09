const globalObj = globalThis as unknown as { global?: any; process?: any };
globalObj.global = globalThis;
globalObj.process = globalObj.process ?? { env: {} };
