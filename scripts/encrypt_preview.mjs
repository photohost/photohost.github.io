import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const password = process.env.NOTION_PREVIEW_PASSWORD;
if (!password || password.length < 20) throw new Error('Set NOTION_PREVIEW_PASSWORD to at least 20 characters');
const iterations = 600_000;
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const source = readFileSync('work/notion-preview/index.html');
const payload = Buffer.concat([cipher.update(source), cipher.final(), cipher.getAuthTag()]);
const encrypted = JSON.stringify({
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    data: payload.toString('base64'), iterations,
});

mkdirSync('work/notion-preview-encrypted', { recursive: true });
writeFileSync('work/notion-preview-encrypted/index.html', `<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>文章預覽</title>
<style>
body { margin: 0; font: 16px system-ui; background: #eee; }
form { max-width: 28rem; margin: 10vh auto; padding: 1.5rem; }
input, button { font: inherit; padding: .5rem; margin: .3rem 0; }
iframe { display: block; width: 100%; height: 100dvh; border: 0; }
iframe[hidden] { display: none; }
</style>
<form>
  <h1>解鎖文章預覽</h1>
  <label>預覽密碼 <input type="password" required></label>
  <button>開啟預覽</button>
  <p role="status"></p>
</form>
<iframe sandbox hidden title="文章預覽"></iframe>
<script>
const encrypted = ${encrypted};
const bytes = base64 => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
const form = document.querySelector('form');
form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    const status = form.querySelector('[role=status]');
    button.disabled = true;
    status.textContent = '解鎖中…';
    try {
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(input.value),
            'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256',
            salt: bytes(encrypted.salt), iterations: encrypted.iterations},
            material, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes(encrypted.iv)},
            key, bytes(encrypted.data));
        const frame = document.querySelector('iframe');
        frame.srcdoc = new TextDecoder().decode(plain);
        frame.hidden = false;
        input.value = '';
        form.hidden = true;
    } catch {
        status.textContent = '無法解鎖。請確認密碼並使用新版瀏覽器開啟。';
    } finally {
        button.disabled = false;
    }
});
</script>
</html>`, 'utf8');
