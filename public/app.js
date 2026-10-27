const form = document.querySelector('#composer');
const promptInput = document.querySelector('#prompt');
const sendButton = document.querySelector('#send');
const messagesEl = document.querySelector('#messages');
const welcome = document.querySelector('#welcome');
const statusEl = document.querySelector('#status');
const settings = document.querySelector('#settings');
const passwordInput = document.querySelector('#appPassword');
const history = [];
let busy = false;

passwordInput.value = localStorage.getItem('lan-gemini-password') || '';
document.querySelector('#settingsButton').addEventListener('click', () => settings.showModal());
document.querySelector('#saveSettings').addEventListener('click', () => {
  localStorage.setItem('lan-gemini-password', passwordInput.value);
  statusEl.textContent = 'Settings saved on this device.';
  setTimeout(() => statusEl.textContent = '', 1800);
});

document.querySelectorAll('.suggestions button').forEach(button => button.addEventListener('click', () => {
  promptInput.value = button.textContent;
  promptInput.focus();
  resizeInput();
}));

function resizeInput() {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
}
promptInput.addEventListener('input', resizeInput);
promptInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});

function addMessage(role, text, pending = false) {
  welcome.hidden = true;
  const row = document.createElement('div');
  row.className = `message ${role}`;
  if (role === 'model') {
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = '🦊'; row.append(avatar);
  }
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text;
  if (pending) bubble.id = 'pending';
  row.append(bubble); messagesEl.append(row);
  document.querySelector('#conversation').scrollTop = document.querySelector('#conversation').scrollHeight;
  return bubble;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const text = promptInput.value.trim();
  if (!text || busy) return;
  busy = true; sendButton.disabled = true; statusEl.textContent = '';
  promptInput.value = ''; resizeInput();
  history.push({ role: 'user', text }); addMessage('user', text);
  const pending = addMessage('model', 'Thinking…', true);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-password': localStorage.getItem('lan-gemini-password') || '' },
      body: JSON.stringify({ messages: history })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request failed.');
    pending.textContent = data.text;
    history.push({ role: 'model', text: data.text });
  } catch (error) {
    pending.closest('.message').remove();
    history.pop();
    statusEl.textContent = error.message;
  } finally {
    busy = false; sendButton.disabled = false; promptInput.focus();
  }
});
