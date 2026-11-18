import { ticketElement } from './ticket.js';

const form = document.getElementById('ticket-form');
const preview = document.getElementById('preview');
const list = document.getElementById('ticket-list');
const message = document.getElementById('form-message');
const draftButton = document.getElementById('save-draft');
const publishButton = document.getElementById('publish');
const fileInput = document.getElementById('poster');
const editorTitle = document.getElementById('editor-title');
const newButton = document.getElementById('new-ticket');
let records = [];
let editingId = null;
let posterKey = null;
let posterUrl = null;
let localUrl = null;
let saving = false;

function setSaving(value) {
  saving = value;
  form.setAttribute('aria-busy', String(value));
  for (const control of [...form.elements, newButton, ...list.querySelectorAll('button')]) {
    control.disabled = value;
  }
}

function fields() {
  return {
    title_zh: form.elements.title_zh.value.trim(),
    title_original: form.elements.title_original.value.trim(),
    kind: form.elements.kind.value,
    rating: form.elements.rating.value,
    watched_on: form.elements.watched_on.value,
    poster_key: posterKey,
    poster_url: localUrl || posterUrl
  };
}

function updatePreview() {
  preview.replaceChildren(ticketElement(fields(), { preview: true }));
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.hidden = !text;
  message.style.borderColor = isError ? '#8b4545' : '#aaa';
}

function reset() {
  form.reset();
  editingId = null;
  posterKey = null;
  posterUrl = null;
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = null;
  editorTitle.textContent = '新票根';
  draftButton.textContent = '儲存草稿';
  setMessage('');
  updatePreview();
}

function selectTicket(ticket, scroll = true) {
  editingId = ticket.id;
  form.elements.title_zh.value = ticket.title_zh || '';
  form.elements.title_original.value = ticket.title_original || '';
  form.elements.kind.value = ticket.kind || '';
  form.elements.rating.value = ticket.rating ?? '';
  form.elements.watched_on.value = ticket.watched_on || '';
  fileInput.value = '';
  posterKey = ticket.poster_key;
  posterUrl = ticket.poster_url;
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = null;
  editorTitle.textContent = `編輯：${ticket.title_zh || '未命名草稿'}`;
  draftButton.textContent = ticket.status === 'published' ? '取消發布並存為草稿' : '儲存草稿';
  setMessage('');
  updatePreview();
  if (scroll) window.scrollTo({ top: 0 });
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  if (response.redirected || response.status === 401 || response.status === 403) {
    throw new Error('目前無法驗證登入，請重新開啟編輯頁。');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `請求失敗（${response.status}）`);
  return result;
}

function drawList() {
  list.replaceChildren();
  document.getElementById('list-loading').textContent = records.length ? '' : '尚無已儲存票根。';
  for (const ticket of records) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'saved-item';
    button.disabled = saving;
    const title = document.createElement('strong');
    title.textContent = ticket.title_zh || '未命名草稿';
    const info = document.createElement('small');
    info.textContent = `${ticket.status === 'published' ? '已發布' : '草稿'} · ${ticket.watched_on || '日期未填'}`;
    button.append(title, info);
    button.addEventListener('click', () => selectTicket(ticket));
    list.append(button);
  }
}

async function reloadList() {
  const result = await api('/api/admin/tickets');
  records = result.tickets;
  drawList();
}

async function compress(file) {
  if (!file.type.startsWith('image/')) throw new Error('請選擇圖片檔案');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('無法讀取圖片，請改用 JPEG、PNG 或 WebP'); });
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .78));
  if (!blob || blob.type !== 'image/webp') throw new Error('無法壓縮圖片，請改用其他圖片');
  if (blob.size > 3_000_000) throw new Error('圖片壓縮後仍超過 3 MB，請選擇較小的圖片');
  return blob;
}

async function save(status) {
  if (saving) return;
  const data = fields();
  if (status === 'published' && !data.kind) {
    setMessage('發布前請選擇作品類型。', true);
    form.elements.kind.focus();
    return;
  }
  if (status === 'published' && (!data.title_zh || data.rating === '' || !data.watched_on || (!fileInput.files[0] && !posterKey))) {
    setMessage('發布前請填入中文片名、評分、日期與圖片。', true);
    return;
  }
  setSaving(true);
  setMessage('正在儲存…');
  try {
    if (fileInput.files[0]) {
      const blob = await compress(fileInput.files[0]);
      const uploaded = await api('/api/admin/posters', {
        method: 'POST', headers: { 'Content-Type': blob.type }, body: blob
      });
      posterKey = uploaded.poster_key;
      posterUrl = uploaded.poster_url;
      fileInput.value = '';
      if (localUrl) URL.revokeObjectURL(localUrl);
      localUrl = null;
    }
    const payload = {
      title_zh: data.title_zh, title_original: data.title_original, kind: data.kind,
      rating: data.rating, watched_on: data.watched_on, poster_key: posterKey, status
    };
    const result = await api(editingId ? `/api/admin/tickets/${editingId}` : '/api/admin/tickets', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    editingId = result.id;
    const success = status === 'published' ? '已發布，公開票根牆現在可以看到。' : '草稿已儲存。';
    try {
      await reloadList();
      const saved = records.find(ticket => ticket.id === editingId);
      if (saved) selectTicket(saved, false);
      setMessage(success);
    } catch {
      draftButton.textContent = status === 'published' ? '取消發布並存為草稿' : '儲存草稿';
      setMessage(`${success}清單暫時無法更新，重新整理後可查看。`);
    }
  } catch (cause) {
    setMessage(cause.message || '儲存失敗，請稍後重試。', true);
  } finally {
    setSaving(false);
  }
}

form.addEventListener('input', updatePreview);
fileInput.addEventListener('change', () => {
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = fileInput.files[0] ? URL.createObjectURL(fileInput.files[0]) : null;
  updatePreview();
});
form.addEventListener('submit', event => event.preventDefault());
draftButton.addEventListener('click', () => save('draft'));
publishButton.addEventListener('click', () => save('published'));
newButton.addEventListener('click', reset);
reset();
reloadList().catch(cause => {
  document.getElementById('list-loading').textContent = cause.message || '無法讀取票根。';
});
