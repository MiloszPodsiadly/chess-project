const globalObj = globalThis as unknown as { global?: any; process?: any };
// sockjs-client's CommonJS bundle reads global and process.env in browser builds.
globalObj.global = globalThis;
globalObj.process = globalObj.process ?? { env: {} };
