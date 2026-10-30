import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const dir = '/home/z/my-project/tool-results/asr_chunks';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function transcribeWithRetry(zai, b64, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await zai.audio.asr.create({ file_base64: b64 });
      return resp.text || '';
    } catch (e) {
      const is429 = e.message.includes('429');
      if (i === tries - 1) throw e;
      await sleep(is429 ? 15000 : 5000);
    }
  }
}

async function main() {
  const zai = await ZAI.create();
  const chunks = fs.readdirSync(dir).filter(f => f.startsWith('c25_') && f.endsWith('.wav')).sort();
  const results = [];
  for (const c of chunks) {
    try {
      const b64 = fs.readFileSync(path.join(dir, c)).toString('base64');
      const text = await transcribeWithRetry(zai, b64);
      results.push({ chunk: c, text });
      console.log(`=== ${c} ===`);
      console.log(text);
      console.log('');
      fs.writeFileSync('/home/z/my-project/tool-results/asr_transcript.json', JSON.stringify(results, null, 2));
      await sleep(3000);
    } catch (e) {
      results.push({ chunk: c, error: e.message });
      console.log(`=== ${c} === ERROR: ${e.message}`);
      await sleep(8000);
    }
  }
  fs.writeFileSync('/home/z/my-project/tool-results/asr_transcript.json', JSON.stringify(results, null, 2));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
