/////////////////////
// INITIAL CONFIG ///
/////////////////////

const socket = io('/');
const ROOM_ID = 'whiteboard-room';
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');

// Global drawing configuration state
let currentStrokeColor = '#000000';
let currentLineWidth = 2;

// Sync color picker wrapper background so the circle shows the chosen colour
const colorPickerWrapper = document.querySelector('.color-picker-wrapper');
function syncColorSwatch(color) {
    if (colorPickerWrapper) colorPickerWrapper.style.background = color;
}

/////////////////////
// THEME TOGGLE   ///
/////////////////////

(function initTheme() {
    const saved = localStorage.getItem('wb-theme') || 'light';
    if (saved === 'light') document.body.setAttribute('data-theme', 'light');
})();

document.getElementById('theme-toggle').addEventListener('click', () => {
    const isLight = document.body.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';

    document.body.setAttribute('data-theme', next);
    localStorage.setItem('wb-theme', next);

    // Re-trigger the spin animation on the visible SVG
    const btn = document.getElementById('theme-toggle');
    const visibleSvg = btn.querySelector(next === 'light' ? '.icon-sun' : '.icon-moon');
    if (visibleSvg) {
        visibleSvg.style.animation = 'none';
        // Force reflow
        void visibleSvg.offsetWidth;
        visibleSvg.style.animation = '';
    }
});

// Adjust canvas to container
function resizeCanvas() {

    // 1. Save curret content in a invis temp canvas
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = canvas.width || 0;
    tempCanvas.height = canvas.height || 0;
    if (canvas.width > 0 && canvas.height > 0) {
        tempCtx.drawImage(canvas, 0, 0);
    }

    // 2. Resize main canvas
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;

    // 3. When window is resize copy saved content
    if (tempCanvas.width > 0 && tempCanvas.height > 0) {
        ctx.drawImage(tempCanvas, 0, 0);
    }

    resetCanvasSettings();
}

function resetCanvasSettings() {
    ctx.strokeStyle = currentStrokeColor;
    ctx.lineWidth = currentLineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

window.addEventListener('load', resizeCanvas);
window.addEventListener('resize', resizeCanvas);

//////////////////
// TOOLS LOGIC ///
//////////////////

let currentTool = 'pencil';
let isDrawing = false;
let startX, startY;
let canvasSnapshot;

// UI tools selection
const toolBtns = document.querySelectorAll('.tool-btn');
toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class of all elements and assign it to current one
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Get tool by ID
        const toolId = btn.id.split('-')[1];
        currentTool = toolId;

        // If its an image, open fs
        if (currentTool === 'image') {
            document.getElementById('imageLoader').click();
        }
    });
});
document.getElementById('tool-pencil').classList.add('active');

// Color picker listener
const colorPicker = document.getElementById('color-picker');
colorPicker.addEventListener('input', (e) => {
    currentStrokeColor = e.target.value;
    syncColorSwatch(e.target.value);
    resetCanvasSettings();
});
// Init swatch
syncColorSwatch(currentStrokeColor);

// Stroke size slider
const strokeSizeSlider = document.getElementById('stroke-size');
if (strokeSizeSlider) {
    strokeSizeSlider.addEventListener('input', (e) => {
        currentLineWidth = parseInt(e.target.value, 10);
        resetCanvasSettings();
    });
}

////////////////////
// DRAWING LOGIC ///
////////////////////

// Extract coords function
function getCoordinates(e) {
    let clientX, clientY;

    // Touch event (drag finger)
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    }
    // Touch event end (lift finger)
    else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    }
    // Mouse event
    else {
        return { x: e.offsetX, y: e.offsetY };
    }

    // Calc relative mouse position
    const rect = canvas.getBoundingClientRect();
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

// Apply local settings to room (other guests)
function applyLocalSettings(tool) {
    if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 24;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = currentStrokeColor;
        ctx.lineWidth = currentLineWidth;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

// 1. Event start
const startDrawing = (e) => {
    // Prevent screen moving on mobile
    if (e.cancelable) e.preventDefault();
    if (currentTool === 'image') return;

    isDrawing = true;
    const pos = getCoordinates(e);
    startX = pos.x;
    startY = pos.y;

    applyLocalSettings(currentTool);

    if (currentTool === 'text') {
        const text = prompt("Insert text:");
        if (text) {
            ctx.font = "24px 'Caveat', Arial";
            ctx.fillText(text, startX, startY);
            emitDrawAction({ type: 'text', text, x0: startX, y0: startY });
        }
        isDrawing = false;
        return;
    }

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
    } else {
        canvasSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
};

// 2. During draw event
const draw = (e) => {
    // Avoid scroll when dragging finger
    if (!isDrawing) return;
    if (e.cancelable) e.preventDefault();

    const pos = getCoordinates(e);

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();

        emitDrawAction({
            type: currentTool,
            x0: startX, y0: startY,
            x1: pos.x, y1: pos.y,
            color: currentTool === 'eraser' ? '#ffffff' : currentStrokeColor,
            lineWidth: currentTool === 'eraser' ? 24 : currentLineWidth
        });

        startX = pos.x;
        startY = pos.y;
    } else {
        ctx.putImageData(canvasSnapshot, 0, 0);
        applyLocalSettings(currentTool);
        drawShape(currentTool, startX, startY, pos.x, pos.y);
    }
};

// 3. Draw event is finished
const stopDrawing = (e) => {
    if (!isDrawing) return;
    if (e.cancelable) e.preventDefault();
    isDrawing = false;

    if (currentTool !== 'pencil' && currentTool !== 'eraser') {
        const pos = getCoordinates(e);
        applyLocalSettings(currentTool);
        drawShape(currentTool, startX, startY, pos.x, pos.y);

        emitDrawAction({
            type: currentTool,
            x0: startX, y0: startY,
            x1: pos.x, y1: pos.y,
            color: currentStrokeColor,
            lineWidth: currentLineWidth
        });
    }
};

////////////////////////
// AUX EVENT LISTENER //
////////////////////////

// Mouse
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// Mobile
canvas.addEventListener('touchstart', startDrawing, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopDrawing);
canvas.addEventListener('touchcancel', stopDrawing);

// Draw shape function
function drawShape(tool, x0, y0, x1, y1) {
    ctx.beginPath();
    // Predetermined coords for every shape
    if (tool === 'line') {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
    } else if (tool === 'square') {
        const width = x1 - x0;
        const height = y1 - y0;
        ctx.rect(x0, y0, width, height);
    } else if (tool === 'circle') {
        const radius = Math.sqrt(Math.pow(x1 - x0, 2) + Math.pow(y1 - y0, 2));
        ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
    } else if (tool === 'triangle') {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x0 * 2 - x1, y1);
        ctx.closePath();
    }
    ctx.stroke();
}

// Load img
document.getElementById('imageLoader').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            // Draw re-escaled img
            ctx.drawImage(img, 50, 50, 200, (200 * img.height) / img.width);
            emitDrawAction({ type: 'image', dataUrl: event.target.result });
        }
        img.src = event.target.result;
    }
    reader.readAsDataURL(file);
});

////////////////////////////
// BOARD CONNECTION LOGIC //
////////////////////////////

function emitDrawAction(data) {
    data.roomId = ROOM_ID;
    socket.emit('draw-action', data);
}

socket.on('draw-action', (data) => {
    // Save previous local state to prevent local configuration overrides
    const prevStroke = ctx.strokeStyle;
    const prevWidth = ctx.lineWidth;
    const prevCap = ctx.lineCap;
    const prevJoin = ctx.lineJoin;
    const prevFill = ctx.fillStyle;
    const prevGCO = ctx.globalCompositeOperation;

    // Apply incoming user specifications
    ctx.strokeStyle = data.color || '#000000';
    ctx.lineWidth = data.lineWidth || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // GCO: apply transparency to eraser
    if (data.type === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
    }

    if (data.type === 'text') {
        ctx.font = "20px Arial";
        ctx.fillText(data.text, data.x0, data.y0);
    } else if (data.type === 'image') {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 50, 50, 200, (200 * img.height) / img.width);
        img.src = data.dataUrl;
    } else if (data.type === 'pencil' || data.type === 'eraser') {
        ctx.beginPath();
        ctx.moveTo(data.x0, data.y0);
        ctx.lineTo(data.x1, data.y1);
        ctx.stroke();
    } else {
        drawShape(data.type, data.x0, data.y0, data.x1, data.y1);
    }

    // Restore local styles seamlessly (prev states)
    ctx.strokeStyle = prevStroke;
    ctx.lineWidth = prevWidth;
    ctx.lineCap = prevCap;
    ctx.lineJoin = prevJoin;
    ctx.fillStyle = prevFill;
    ctx.globalCompositeOperation = prevGCO;
});

/////////////////
// AUDIO LOGIC //
/////////////////

let localAudioStream;
const peers = {};

async function startAudio() {
    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        socket.emit('join-room', ROOM_ID);
    } catch (e) {
        alert("Allow mic access to speak.");
    }
}

// Mute mic
const localMicBtn = document.getElementById('local-mic-btn');
localMicBtn.addEventListener('click', () => {
    if (!localAudioStream) return;
    const track = localAudioStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    // Toggle the 'muted' class which swaps the SVG icons via CSS
    localMicBtn.classList.toggle('muted');
});

// Init WebRTC
function createPeerConnection(userId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] });

    localAudioStream.getTracks().forEach(track => pc.addTrack(track, localAudioStream));

    pc.ontrack = (event) => {
        // On audio received: create UI on right sidebar
        if (!document.getElementById(`user-${userId}`)) {
            createUserUI(userId, event.streams[0]);
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { candidate: event.candidate, targetId: userId });
        }
    };

    peers[userId] = pc;
    return pc;
}

// Create UI elements for remote users
function createUserUI(userId, stream) {
    const usersList = document.getElementById('users-list');

    const div = document.createElement('div');
    div.className = 'user-item';
    div.id = `user-${userId}`;

    // Hidden audio tag
    const audioEl = document.createElement('audio');
    audioEl.srcObject = stream;
    audioEl.autoplay = true;
    div.appendChild(audioEl);

    // Avatar with a deterministic hue from userId
    const hue = (userId.charCodeAt(0) * 47 + userId.charCodeAt(1) * 13) % 360;
    const icon = document.createElement('span');
    icon.className = 'user-avatar';
    icon.style.setProperty('--avatar-hue', hue);
    icon.innerText = userId.substring(0, 1).toUpperCase();

    // Speaker icon
    const speakerBtn = document.createElement('button');
    speakerBtn.className = 'audio-btn speaker-btn';
    speakerBtn.innerText = '🔊';
    speakerBtn.title = 'Silence user audio';

    speakerBtn.onclick = () => {
        audioEl.muted = !audioEl.muted;
        speakerBtn.classList.toggle('crossed'); // Poner la cruz del mockup
    };

    // Mic iocn
    const micBtn = document.createElement('button');
    micBtn.className = 'audio-btn mic-btn';
    micBtn.innerText = '🎙️';
    // disabled because local user can disabled guest mic remotely
    micBtn.disabled = true;

    // Unique identifier
    const idSpan = document.createElement('span');
    idSpan.className = 'user-id';
    idSpan.innerText = userId.substring(0, 5);

    // Wrap audio buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'user-actions';
    actionsDiv.append(speakerBtn, micBtn);

    div.append(icon, idSpan, actionsDiv);
    usersList.appendChild(div);
    updateUserCount();
}

///////////////////
// WebRTC EVENTS //
///////////////////

socket.on('user-connected', async (userId) => {
    const pc = createPeerConnection(userId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { sdp: offer, targetId: userId });
});

socket.on('offer', async (data) => {
    const pc = createPeerConnection(data.senderId);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { sdp: answer, targetId: data.senderId });
});

socket.on('answer', async (data) => {
    const pc = peers[data.senderId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
});

socket.on('ice-candidate', async (data) => {
    const pc = peers[data.senderId];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
});

socket.on('user-disconnected', (userId) => {
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    const userUI = document.getElementById(`user-${userId}`);
    if (userUI) userUI.remove();
});

// ---- Status badge ----
const statusBadge = document.getElementById('status-badge');
const statusText = statusBadge ? statusBadge.querySelector('.status-text') : null;

socket.on('connect', () => {
    if (statusBadge) statusBadge.classList.add('connected');
    if (statusText) statusText.textContent = 'Connected';
});

socket.on('disconnect', () => {
    if (statusBadge) statusBadge.classList.remove('connected');
    if (statusText) statusText.textContent = 'Disconnected';
});

// ---- User count ----
function updateUserCount() {
    const userItems = document.querySelectorAll('#users-list .user-item');
    const userCountEl = document.getElementById('user-count');
    if (userCountEl) userCountEl.innerText = userItems.length;
}

updateUserCount();
startAudio();