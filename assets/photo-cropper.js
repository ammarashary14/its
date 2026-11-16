const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 800;
const MAX_ENCODED_LENGTH = 340000;
let activeCropper = null;
let sequence = 0;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}
function positive(value, label) {
  if (finite(value, label) <= 0) throw new Error(`${label} must be positive.`);
  return value;
}
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

/** Geometry uses output pixels, so preview size never changes the saved crop. */
export function computeCrop(width, height, transform = {}, targetWidth = OUTPUT_WIDTH, targetHeight = OUTPUT_HEIGHT) {
  positive(width, 'Image width'); positive(height, 'Image height');
  positive(targetWidth, 'Crop width'); positive(targetHeight, 'Crop height');
  const zoom = clamp(finite(transform.zoom ?? 1, 'Zoom'), 1, 4);
  const rotation = ((Math.round(finite(transform.rotation ?? 0, 'Rotation') / 90) * 90) % 360 + 360) % 360;
  const quarterTurn = rotation === 90 || rotation === 270;
  const rotatedWidth = quarterTurn ? height : width;
  const rotatedHeight = quarterTurn ? width : height;
  const scale = Math.max(targetWidth / rotatedWidth, targetHeight / rotatedHeight) * zoom;
  const maxX = Math.max(0, (rotatedWidth * scale - targetWidth) / 2);
  const maxY = Math.max(0, (rotatedHeight * scale - targetHeight) / 2);
  return {
    width, height, rotatedWidth, rotatedHeight, rotation, zoom, scale,
    x: clamp(finite(transform.x ?? 0, 'Horizontal position'), -maxX, maxX),
    y: clamp(finite(transform.y ?? 0, 'Vertical position'), -maxY, maxY),
    maxX, maxY, targetWidth, targetHeight
  };
}

/** Inverse of the canvas transform, useful for verifying crop boundaries. */
export function sourcePoint(crop, x, y) {
  finite(x, 'Horizontal coordinate'); finite(y, 'Vertical coordinate');
  const horizontal = (x - crop.targetWidth / 2 - crop.x) / crop.scale;
  const vertical = (y - crop.targetHeight / 2 - crop.y) / crop.scale;
  const angle = crop.rotation * Math.PI / 180;
  return {
    x: horizontal * Math.cos(angle) + vertical * Math.sin(angle) + crop.width / 2,
    y: -horizontal * Math.sin(angle) + vertical * Math.cos(angle) + crop.height / 2
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className = 'crop-secondary') {
  const node = element('button', className, text); node.type = 'button'; return node;
}
function sourceURL(source) {
  if (typeof source === 'string') {
    if (source.length > 14 * 1024 * 1024 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) {
      throw new Error('Choose a JPG, PNG, or WebP photo.');
    }
    return { url: source, revoke: () => {} };
  }
  if (!(source instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(source.type)) {
    throw new Error('Choose a JPG, PNG, or WebP photo.');
  }
  if (!source.size || source.size > 10 * 1024 * 1024) throw new Error('Choose a photo smaller than 10 MB.');
  const url = URL.createObjectURL(source);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
function loadImage(source, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let resource;
    try { resource = sourceURL(source); } catch (error) { reject(error); return; }
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; image.onload = null; image.onerror = null;
      signal.removeEventListener('abort', abort); resource.revoke();
      if (error) { image.src = ''; reject(error); } else resolve(image);
    };
    const abort = () => finish(new DOMException('Photo editing canceled.', 'AbortError'));
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) {
        finish(new Error('Choose a smaller photo, under 50 megapixels.')); return;
      }
      finish();
    };
    image.onerror = () => finish(new Error('This photo could not be opened. Close the editor and try another image.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    image.src = resource.url;
  });
}

/** Opens a local-only editor. Resolves to a 4:5 JPEG crop, or null on cancel. */
export async function editProfilePhoto(source, { existing = false } = {}) {
  if (activeCropper) throw new Error('Finish editing the current photo first.');
  const dialog = element('dialog', 'photo-cropper');
  if (typeof dialog.showModal !== 'function') throw new Error('Photo editing needs a recent browser. Please update your browser and try again.');
  const prefix = `photo-crop-${++sequence}`;
  const previousFocus = document.activeElement;
  const abortController = new AbortController();
  const heading = element('h2', '', 'Adjust profile photo.'); heading.id = `${prefix}-title`;
  const intro = element('p', 'crop-intro', 'Move the photo inside the frame, then adjust the zoom.');
  const header = element('div', 'crop-heading'); header.append(heading, intro);
  const canvas = element('canvas', 'crop-canvas'); canvas.width = OUTPUT_WIDTH; canvas.height = OUTPUT_HEIGHT;
  canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Profile photo crop preview. Use the arrow keys to move the photo.');
  const stage = element('div', 'crop-stage'); stage.append(canvas);
  const instructions = element('p', 'crop-instructions', 'Drag to move · Arrow keys for fine adjustments · Shift + arrow for larger steps');
  instructions.id = `${prefix}-instructions`; canvas.setAttribute('aria-describedby', instructions.id);
  const preview = element('div', 'crop-preview'); preview.append(stage, instructions);
  const controls = element('div', 'crop-controls');
  function slider(name, label, min, max, step, initial) {
    const wrapper = element('div', 'crop-control');
    const caption = element('label', '', label); caption.htmlFor = `${prefix}-${name}`;
    const output = element('output'); output.htmlFor = caption.htmlFor;
    const row = element('div', 'crop-control-caption'); row.append(caption, output);
    const input = element('input'); input.id = caption.htmlFor; input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(initial);
    wrapper.append(row, input); controls.append(wrapper); return { input, output };
  }
  const zoom = slider('zoom', 'Zoom', 1, 4, .01, 1);
  const horizontal = slider('horizontal', 'Horizontal position', -100, 100, 1, 0);
  const vertical = slider('vertical', 'Vertical position', -100, 100, 1, 0);
  const rotate = button('Rotate 90° ↻');
  const reset = button('Reset');
  const tools = element('div', 'crop-tools'); tools.append(rotate, reset); controls.append(tools);
  const hint = element('p', 'crop-hint', existing
    ? 'This edits the saved photo. Upload the original again to include areas outside an earlier crop.'
    : 'The portrait frame matches the photo on your team page. Your original file stays unchanged.');
  controls.append(hint);
  const content = element('div', 'crop-content'); content.append(preview, controls);
  const status = element('p', 'crop-status', 'Opening your photo…');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const error = element('p', 'crop-error'); error.setAttribute('role', 'alert'); error.tabIndex = -1; error.hidden = true;
  const cancel = button('Cancel');
  const apply = button('Use this crop', 'crop-primary');
  const footer = element('div', 'crop-footer'); footer.append(cancel, apply);
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.append(header, content, status, error, footer);
  let image = null, transform = { zoom: 1, rotation: 0, x: 0, y: 0 }, geometry = null;
  let closed = false, busy = false, drag = null;
  const context = canvas.getContext('2d');
  const listeners = [];
  const listen = (node, name, handler, options) => { node.addEventListener(name, handler, options); listeners.push(() => node.removeEventListener(name, handler, options)); };
  function syncControls() {
    const unavailable = !image || busy;
    zoom.input.disabled = unavailable; horizontal.input.disabled = unavailable || !geometry?.maxX;
    vertical.input.disabled = unavailable || !geometry?.maxY;
    rotate.disabled = unavailable; reset.disabled = unavailable; apply.disabled = unavailable;
    canvas.setAttribute('aria-disabled', String(unavailable)); canvas.classList.toggle('is-busy', unavailable);
    zoom.output.textContent = `${Math.round(transform.zoom * 100)}%`;
    zoom.input.value = String(transform.zoom); zoom.input.setAttribute('aria-valuetext', zoom.output.textContent);
    const x = geometry?.maxX ? Math.round(transform.x / geometry.maxX * 100) : 0;
    const y = geometry?.maxY ? Math.round(transform.y / geometry.maxY * 100) : 0;
    horizontal.input.value = String(x); vertical.input.value = String(y);
    horizontal.output.textContent = x === 0 ? 'Centered' : `${Math.abs(x)}% ${x < 0 ? 'left' : 'right'}`;
    vertical.output.textContent = y === 0 ? 'Centered' : `${Math.abs(y)}% ${y < 0 ? 'up' : 'down'}`;
    horizontal.input.setAttribute('aria-valuetext', horizontal.output.textContent);
    vertical.input.setAttribute('aria-valuetext', vertical.output.textContent);
  }
  function draw() {
    if (!image || !context || closed) return;
    geometry = computeCrop(image.naturalWidth, image.naturalHeight, transform);
    transform = { zoom: geometry.zoom, rotation: geometry.rotation, x: geometry.x, y: geometry.y };
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#e9dfce'; context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.save();
    context.translate(OUTPUT_WIDTH / 2 + geometry.x, OUTPUT_HEIGHT / 2 + geometry.y);
    context.rotate(geometry.rotation * Math.PI / 180); context.scale(geometry.scale, geometry.scale);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    context.restore(); syncControls();
  }
  syncControls();
  activeCropper = dialog;
  document.body.append(dialog);
  return new Promise(resolve => {
    const finish = value => {
      if (closed) return;
      closed = true; abortController.abort(); listeners.forEach(remove => remove());
      if (image) { image.src = ''; image = null; }
      if (dialog.open) dialog.close(); dialog.remove(); activeCropper = null;
      canvas.width = 0; canvas.height = 0;
      resolve(value);
      // The caller may re-render and unlock its controls after this promise settles.
      setTimeout(() => {
        if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({ preventScroll: true });
        else document.querySelector('#person-photo, #heading-people')?.focus({ preventScroll: true });
      }, 0);
    };
    listen(cancel, 'click', () => finish(null));
    listen(dialog, 'cancel', event => { event.preventDefault(); finish(null); });
    listen(dialog, 'close', () => finish(null));
    listen(zoom.input, 'input', () => {
      if (!image || busy) return;
      const next = Number(zoom.input.value); const ratio = next / transform.zoom;
      transform.x *= ratio; transform.y *= ratio; transform.zoom = next; draw();
    });
    listen(horizontal.input, 'input', () => { if (!geometry || busy) return; transform.x = Number(horizontal.input.value) / 100 * geometry.maxX; draw(); });
    listen(vertical.input, 'input', () => { if (!geometry || busy) return; transform.y = Number(vertical.input.value) / 100 * geometry.maxY; draw(); });
    listen(rotate, 'click', () => { if (!image || busy) return; transform = { zoom: 1, rotation: (transform.rotation + 90) % 360, x: 0, y: 0 }; draw(); status.textContent = `Rotated ${transform.rotation} degrees.`; });
    listen(reset, 'click', () => { if (!image || busy) return; transform = { zoom: 1, rotation: 0, x: 0, y: 0 }; draw(); status.textContent = 'Crop reset.'; });
    listen(canvas, 'pointerdown', event => {
      if (!image || busy || (event.pointerType === 'mouse' && event.button !== 0) || drag) return;
      event.preventDefault(); canvas.focus({ preventScroll: true });
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture?.(event.pointerId); canvas.classList.add('is-dragging');
    });
    listen(canvas, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId || !image || busy) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      transform.x += (event.clientX - drag.x) * OUTPUT_WIDTH / rect.width;
      transform.y += (event.clientY - drag.y) * OUTPUT_HEIGHT / rect.height;
      drag.x = event.clientX; drag.y = event.clientY; draw();
    });
    const endDrag = event => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null; canvas.classList.remove('is-dragging');
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    listen(canvas, 'pointerup', endDrag); listen(canvas, 'pointercancel', endDrag); listen(canvas, 'lostpointercapture', endDrag);
    listen(canvas, 'keydown', event => {
      if (!image || busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const step = event.shiftKey ? 30 : 6;
      if (event.key === 'ArrowLeft') transform.x -= step;
      if (event.key === 'ArrowRight') transform.x += step;
      if (event.key === 'ArrowUp') transform.y -= step;
      if (event.key === 'ArrowDown') transform.y += step;
      draw();
    });
    listen(apply, 'click', async () => {
      if (!image || busy || closed) return;
      busy = true; syncControls(); error.hidden = true; status.textContent = 'Preparing your crop…';
      await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
      if (closed) return;
      try {
        let photo = '';
        for (const quality of [.9, .82, .74, .64, .54, .44]) {
          photo = canvas.toDataURL('image/jpeg', quality);
          if (photo.startsWith('data:image/jpeg;base64,') && photo.length <= MAX_ENCODED_LENGTH) break;
        }
        if (!photo.startsWith('data:image/jpeg;base64,') || photo.length > MAX_ENCODED_LENGTH) throw new Error('This crop is still too large. Try a closer crop or upload a smaller photo.');
        finish(photo);
      } catch (cause) {
        error.textContent = cause.message || 'The crop could not be saved. Please try again.';
        error.hidden = false; status.textContent = ''; error.focus();
      } finally { if (!closed) { busy = false; syncControls(); } }
    });
    try { dialog.showModal(); cancel.focus({ preventScroll: true }); }
    catch { finish(null); return; }
    if (!context) { error.textContent = 'Photo editing is unavailable in this browser. Close the editor and try another browser.'; error.hidden = false; status.textContent = ''; return; }
    loadImage(source, abortController.signal).then(loaded => {
      if (closed) { loaded.src = ''; return; }
      image = loaded; draw(); status.textContent = 'Ready to adjust. Nothing changes until you use this crop.';
      zoom.input.focus({ preventScroll: true });
    }).catch(cause => {
      if (closed) return;
      error.textContent = cause.message || 'This photo could not be opened.'; error.hidden = false; status.textContent = ''; error.focus();
    });
  });
}
