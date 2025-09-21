// Supabase client (ESM via CDN)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://kssqqrunttoblwfopdvj.supabase.co';
// Prefer providing the anon key at runtime via: window.SUPABASE_ANON_KEY = '<anon-key>'
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) || 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// script.js — Client-side validation and success state

function qs(sel, root = document) { return root.querySelector(sel); }

// Placeholder avatar (inline SVG data URL)
const AVATAR_PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="%23e6f3fb"/><circle cx="64" cy="48" r="24" fill="%23b7cfe3"/><path d="M20 108c6-22 26-36 44-36s38 14 44 36" fill="%23b7cfe3"/></svg>';

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function uploadAvatarIfAny() {
  if (!avatarInput || !avatarInput.files || !avatarInput.files[0]) return { path: null, signedUrl: null };
  const file = avatarInput.files[0];
  // Basic validation: max 5MB, image only
  if (!/^image\//.test(file.type)) {
    setError(avatarInput, 'Please upload a valid image file.');
    return { path: null, signedUrl: null, error: new Error('Invalid file type') };
  }
  if (file.size > 5 * 1024 * 1024) {
    setError(avatarInput, 'Image is too large (max 5MB).');
    return { path: null, signedUrl: null, error: new Error('File too large') };
  }

  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}.enc`;

  try {
    // Build a DataURL preview for immediate rendering on success page
    const previewDataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });

    // Client-side encrypt the image before upload (AES-GCM 256)
    const raw = await file.arrayBuffer();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
    const exported = await crypto.subtle.exportKey('raw', key);
    const encBlob = new Blob([ciphertext], { type: 'application/octet-stream' });

    const { error: upErr } = await supabase.storage.from('avatars').upload(fileName, encBlob, {
      contentType: 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    });
    if (upErr) return { path: null, signedUrl: null, error: upErr };

    // Create a short-lived signed URL for immediate display (7 days)
    const { data: signed, error: signErr } = await supabase.storage
      .from('avatars')
      .createSignedUrl(fileName, 60 * 60 * 24 * 7);
    if (signErr) return { path: fileName, signedUrl: null, error: signErr };

    // Return encryption params (base64) for client-side decrypt later
    return { path: fileName, signedUrl: signed.signedUrl, previewDataUrl, keyB64: bufToB64(exported), ivB64: bufToB64(iv), origExt: ext, origType: file.type };
  } catch (e) {
    return { path: null, signedUrl: null, error: e };
  }
}
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

const form = qs('#registration-form');
const errorSummary = qs('#error-summary');
const successBox = qs('#form-success');
const submitBtn = document.querySelector('.btn-primary');
const avatarInput = qs('#avatar');
const avatarPreview = qs('#avatarPreview');
const avatarUploader = qs('.avatar-uploader');
const avatarUploadBtn = qs('#avatarUploadBtn');
const avatarChangeBtn = qs('#avatarChangeBtn');
const avatarDeleteBtn = qs('#avatarDeleteBtn');

function setAvatarControls(state) {
  const has = state === 'has';
  if (avatarUploadBtn) avatarUploadBtn.hidden = has;
  if (avatarChangeBtn) avatarChangeBtn.hidden = !has;
  if (avatarDeleteBtn) avatarDeleteBtn.hidden = !has;
}

// Init preview with placeholder and make the whole circle clickable
if (avatarPreview && !avatarPreview.getAttribute('src')) {
  avatarPreview.setAttribute('src', AVATAR_PLACEHOLDER);
}
if (avatarUploader && avatarInput) {
  avatarUploader.style.cursor = 'pointer';
  avatarUploader.addEventListener('click', (e) => {
    // If the actual "Change" label was clicked, the default label behavior will open the file dialog.
    // For any other area inside the circle, trigger the input click.
    if (!(e.target && e.target.closest && e.target.closest('label.avatar-change'))) {
      avatarInput.click();
    }
  });
}

// Initial control state
if (avatarInput && avatarInput.files && avatarInput.files.length > 0) {
  setAvatarControls('has');
} else {
  setAvatarControls('empty');
}

// External buttons
avatarUploadBtn?.addEventListener('click', () => avatarInput?.click());
avatarChangeBtn?.addEventListener('click', () => avatarInput?.click());
avatarDeleteBtn?.addEventListener('click', () => {
  if (!avatarInput || !avatarPreview) return;
  avatarInput.value = '';
  avatarPreview.setAttribute('src', AVATAR_PLACEHOLDER);
  setError(avatarInput, '');
  setAvatarControls('empty');
});

// Live preview on file select
if (avatarInput && avatarPreview) {
  avatarInput.addEventListener('change', () => {
    const file = avatarInput.files && avatarInput.files[0];
    if (!file) { avatarPreview.setAttribute('src', AVATAR_PLACEHOLDER); setAvatarControls('empty'); return; }
    if (!/^image\//.test(file.type)) {
      setError(avatarInput, 'Please upload a valid image file.');
      avatarPreview.setAttribute('src', AVATAR_PLACEHOLDER);
      setAvatarControls('empty');
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      avatarPreview.setAttribute('src', fr.result);
      setError(avatarInput, '');
      setAvatarControls('has');
    };
    fr.readAsDataURL(file);
  });
}

function setError(input, message) {
  const errorEl = qs(`#${input.id}-error`);
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    if (errorEl) errorEl.textContent = message;
  } else {
    input.removeAttribute('aria-invalid');
    if (errorEl) errorEl.textContent = '';
  }
}

// Detect Postgres duplicate key (unique constraint) errors returned by Supabase
function isDuplicateError(err) {
  if (!err) return false;
  const msg = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase();
  // 23505 is the standard Postgres code for unique violation
  if (err.code === '23505') return true;
  // Fallback: look for common phrases/index names
  if (msg.includes('duplicate key') || msg.includes('already exists')) return true;
  if (msg.includes('registrations_email_norm_key') || msg.includes('email_norm')) return true;
  return false;
}

function showEmailDuplicateError() {
  const emailInput = qs('#email');
  if (emailInput) {
    setError(emailInput, 'This email is already registered for NTCE 2025.');
    try { emailInput.focus(); } catch {}
  }
  if (errorSummary) {
    errorSummary.hidden = false;
    errorSummary.innerHTML = '<p>This email is already registered for NTCE 2025.</p>';
  }
}

// Validate an individual field and set its error message. Returns true if valid.
function validateField(input) {
  if (!input) return true;
  const id = input.id;
  const val = input.value.trim();

  if (id === 'fullName') {
    if (!val) return setError(input, 'Full name is required.'), false;
    if (val.split(/\s+/).length < 2) return setError(input, 'Please enter your first and last name.'), false;
    return setError(input, ''), true;
  }

  if (id === 'email') {
    if (!val) return setError(input, 'Email is required.'), false;
    if (!/.+@.+\..+/.test(val)) return setError(input, 'Please enter a valid email address.'), false;
    return setError(input, ''), true;
  }

  if (id === 'phone') {
    const digits = val.replace(/\D/g, '');
    if (!digits) return setError(input, 'Mobile phone is required.'), false;
    if (digits.length < 7) return setError(input, 'Please enter a valid phone number.'), false;
    return setError(input, ''), true;
  }

  if (id === 'org') {
    if (input.value && input.value.trim().length === 0) return setError(input, 'Please enter a valid organization name.'), false;
    return setError(input, ''), true;
  }

  if (id === 'linkedin') {
    // Make this a free-form optional field with no validation constraints
    return setError(input, ''), true;
  }

  return true;
}

// Validate all fields; optionally focus the first invalid. Returns true if all valid.
function validateAll({ focusFirstInvalid = false } = {}) {
  const fields = ['#fullName', '#email', '#phone', '#org', '#linkedin'].map(sel => qs(sel));
  const categoryError = qs('#category-error');
  if (categoryError) categoryError.textContent = '';

  let firstInvalid = null;
  let hasErrors = false;

  fields.forEach(input => {
    const ok = validateField(input);
    if (!ok) {
      hasErrors = true;
      firstInvalid = firstInvalid || input;
    }
  });

  if (hasErrors) {
    errorSummary.hidden = false;
    successBox.hidden = true;
    if (focusFirstInvalid && firstInvalid) firstInvalid.focus();
  } else {
    errorSummary.hidden = true;
  }

  return !hasErrors;
}

async function insertIntoSupabase(payload) {
  try {
    // Use returning: 'minimal' so we don't need a SELECT policy
    const { error } = await supabase
      .from('registrations')
      .insert(payload, { returning: 'minimal' });
    return { data: null, error };
  } catch (e) {
    return { data: null, error: e };
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  if (!validateAll({ focusFirstInvalid: true })) return;

  // Collect data (form names must match DB column names mapped below)
  const fd = new FormData(form);
  // Upload avatar if present (before inserting record)
  const { path: avatar_path, signedUrl: avatarUrl, previewDataUrl, keyB64: avatarKey, ivB64: avatarIv, origExt, origType, error: avatarErr } = await uploadAvatarIfAny();
  if (avatarErr && avatarInput && avatarInput.files && avatarInput.files[0]) {
    errorSummary.hidden = false;
    errorSummary.innerHTML = '<p>Could not upload your photo. Please try a smaller image or different format.</p>';
    return;
  }
  const emailVal = String(fd.get('email') || '').trim();
  const payload = {
    full_name: fd.get('fullName') || null,
    email: emailVal || null,
    phone: fd.get('phone') || null,
    organization: fd.get('organization') || null,
    category: fd.get('category') || null,
    linkedin_url: fd.get('linkedin') || null,
    avatar_path: avatar_path || null,
  };

  // Local fallback persistence (optional)
  try {
    const list = JSON.parse(localStorage.getItem('registrations') || '[]');
    list.push({ ...payload, createdAt: new Date().toISOString() });
    localStorage.setItem('registrations', JSON.stringify(list));
  } catch {}

  // Submit to Supabase
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.textContent;
    submitBtn.textContent = 'Submitting…';
  }

  const { error } = await insertIntoSupabase(payload);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = submitBtn.dataset.originalText || 'Submit';
  }

  if (error) {
    console.warn('Supabase insert error:', error);
    if (isDuplicateError(error)) {
      showEmailDuplicateError();
    } else {
      errorSummary.hidden = false;
      errorSummary.innerHTML = '<p>Could not save your registration to the server. Please check your connection and try again.</p>';
    }
    return;
  }

  // UI: success state
  successBox.hidden = false;
  // Optionally clear the form: form.reset();

  // Persist registration for success page and redirect
  try {
    const fd = new FormData(form);
    const reg = Object.fromEntries(fd.entries());
    if (avatarUrl) {
      reg.avatarUrl = avatarUrl;
      if (previewDataUrl) reg.avatarDataUrl = previewDataUrl;
      if (avatarKey && avatarIv) {
        reg.avatarKey = avatarKey;
        reg.avatarIv = avatarIv;
      }
      if (origExt) reg.avatarExt = origExt;
      if (origType) reg.avatarType = origType;
    }
    sessionStorage.setItem('registration', JSON.stringify(reg));
  } catch {}
  // Navigate to success page
  window.location.href = './success.html';
}

if (form) {
  form.addEventListener('submit', handleSubmit);

  // Validate on blur for helpful early feedback
  qsa('input, select, textarea', form).forEach(el => {
    el.addEventListener('blur', (e) => {
      // Only validate this field; do not steal focus or show summary
      validateField(e.target);
    });
  });
}
