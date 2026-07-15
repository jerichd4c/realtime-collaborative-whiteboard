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
    const saved = localStorage.getItem('wb-theme') || 'dark';
    if (saved === 'light') document.body.setAttribute('data-theme', 'light');
})();

document.getElementById('theme-toggle').addEventListener('click', () => {
    const isLight = document.body.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('wb-theme', next);
    const btn = document.getElementById('theme-toggle');
    const visibleSvg = btn.querySelector(next === 'light' ? '.icon-sun' : '.icon-moon');
    if (visibleSvg) {
        visibleSvg.style.animation = 'none';
        void visibleSvg.offsetWidth;
        visibleSvg.style.animation = '';
    }
});

/////////////////////
// SCENE GRAPH    ///
/////////////////////

let scene = [];        // Ordered list of all drawn objects
let idCounter = 0;

function generateId() {
    // Combine socket id + timestamp + counter for uniqueness across clients
    return `${(socket.id || 'local').slice(0, 6)}-${Date.now()}-${idCounter++}`;
}

///////////////////////
// VIEWPORT / PAN   ///
///////////////////////

let panX = 0;
let panY = 0;
let isPanning = false;
let _panStartScreenX = 0;
let _panStartScreenY = 0;
let _panStartPanX = 0;
let _panStartPanY = 0;

/** Convert screen (canvas pixel) coords → world (scene) coords */
function screenToWorld(sx, sy) {
    return { x: sx - panX, y: sy - panY };
}

//////////////////////
// RENDER PIPELINE ///
//////////////////////

function renderScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(panX, panY);  // apply viewport

    for (const obj of scene) {
        renderObject(obj);
    }

    // Selection overlay drawn last (on top)
    if (selectedId !== null) {
        const obj = scene.find(o => o.id === selectedId);
        if (obj) drawSelectionBox(obj);
    }

    ctx.restore();
}

function renderObject(obj) {
    ctx.save();
    ctx.globalCompositeOperation = (obj.type === 'eraser') ? 'destination-out' : 'source-over';
    ctx.strokeStyle = obj.color || '#000000';
    ctx.fillStyle   = obj.color || '#000000';
    ctx.lineWidth   = obj.lineWidth || 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    switch (obj.type) {
        case 'pencil':
        case 'eraser':
            if (obj.points && obj.points.length > 1) {
                ctx.beginPath();
                ctx.moveTo(obj.points[0].x, obj.points[0].y);
                for (let i = 1; i < obj.points.length; i++) {
                    ctx.lineTo(obj.points[i].x, obj.points[i].y);
                }
                ctx.stroke();
            }
            break;

        case 'line':
            ctx.beginPath();
            ctx.moveTo(obj.x0, obj.y0);
            ctx.lineTo(obj.x1, obj.y1);
            ctx.stroke();
            break;

        case 'square':
            ctx.beginPath();
            ctx.rect(obj.x0, obj.y0, obj.x1 - obj.x0, obj.y1 - obj.y0);
            ctx.stroke();
            break;

        case 'circle': {
            const r = Math.hypot(obj.x1 - obj.x0, obj.y1 - obj.y0);
            ctx.beginPath();
            ctx.arc(obj.x0, obj.y0, r, 0, 2 * Math.PI);
            ctx.stroke();
            break;
        }

        case 'triangle':
            ctx.beginPath();
            ctx.moveTo(obj.x0, obj.y0);
            ctx.lineTo(obj.x1, obj.y1);
            ctx.lineTo(obj.x0 * 2 - obj.x1, obj.y1);
            ctx.closePath();
            ctx.stroke();
            break;

        case 'text':
            ctx.globalCompositeOperation = 'source-over';
            ctx.font = "24px 'Caveat', Arial";
            ctx.fillText(obj.text, obj.x0, obj.y0);
            break;

        case 'image':
            ctx.globalCompositeOperation = 'source-over';
            if (obj._img) {
                ctx.drawImage(obj._img, obj.x, obj.y, obj.w, obj.h);
            } else {
                // Load and cache the image, then re-render
                const img = new Image();
                img.onload = () => { obj._img = img; renderScene(); };
                img.src = obj.dataUrl;
            }
            break;
    }
    ctx.restore();
}

/** Returns the axis-aligned bounding box for any scene object */
function getObjectBBox(obj) {
    const lw = (obj.lineWidth || 2) / 2;
    switch (obj.type) {
        case 'pencil':
        case 'eraser': {
            if (!obj.points || obj.points.length === 0) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of obj.points) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
            return { x: minX - lw, y: minY - lw, w: (maxX - minX) + lw * 2, h: (maxY - minY) + lw * 2 };
        }
        case 'line':
            return {
                x: Math.min(obj.x0, obj.x1) - lw,
                y: Math.min(obj.y0, obj.y1) - lw,
                w: Math.abs(obj.x1 - obj.x0) + lw * 2,
                h: Math.abs(obj.y1 - obj.y0) + lw * 2
            };
        case 'square':
            return {
                x: Math.min(obj.x0, obj.x1),
                y: Math.min(obj.y0, obj.y1),
                w: Math.abs(obj.x1 - obj.x0),
                h: Math.abs(obj.y1 - obj.y0)
            };
        case 'circle': {
            const r = Math.hypot(obj.x1 - obj.x0, obj.y1 - obj.y0);
            return { x: obj.x0 - r, y: obj.y0 - r, w: r * 2, h: r * 2 };
        }
        case 'triangle': {
            const tipX  = obj.x0;
            const tipY  = obj.y0;
            const rightX = obj.x1;
            const leftX  = obj.x0 * 2 - obj.x1;
            const botY   = obj.y1;
            return {
                x: Math.min(tipX, leftX, rightX),
                y: Math.min(tipY, botY),
                w: Math.max(tipX, leftX, rightX) - Math.min(tipX, leftX, rightX),
                h: Math.abs(botY - tipY)
            };
        }
        case 'text':
            // Approximate: 200px wide, 30px tall
            return { x: obj.x0 - 4, y: obj.y0 - 26, w: 200, h: 30 };
        case 'image':
            return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
        default:
            return null;
    }
}

/** Draw the dashed selection rectangle + corner handles */
function drawSelectionBox(obj) {
    const bbox = getObjectBBox(obj);
    if (!bbox) return;

    const pad = 10;
    const x = bbox.x - pad;
    const y = bbox.y - pad;
    const w = bbox.w + pad * 2;
    const h = bbox.h + pad * 2;

    ctx.save();

    // Dashed border
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Corner handles
    const hs = 8;
    const corners = [
        [x, y], [x + w, y],
        [x, y + h], [x + w, y + h]
    ];
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    for (const [cx, cy] of corners) {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }

    ctx.restore();
}

//////////////////////
// CANVAS RESIZE   ///
//////////////////////

function resizeCanvas() {
    canvas.width  = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    renderScene();
}

function resetCanvasSettings() {
    ctx.strokeStyle = currentStrokeColor;
    ctx.lineWidth   = currentLineWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
}

window.addEventListener('load', resizeCanvas);
window.addEventListener('resize', resizeCanvas);

//////////////////
// TOOLS LOGIC ///
//////////////////

let currentTool  = 'pencil';
let isDrawing    = false;
let startX, startY;
let activeObject = null;   // object currently being drawn

// Selection state
let selectedId       = null;
let isDragging       = false;
let dragStartWorldX  = 0;
let dragStartWorldY  = 0;
let dragOriginalData = null;  // deep-copy of object coords before drag starts

// UI tool selection
const toolBtns = document.querySelectorAll('.tool-btn');
toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Skip non-tool buttons (theme toggle, etc.)
        if (!btn.id.startsWith('tool-')) return;

        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        currentTool = btn.id.replace('tool-', '');

        if (currentTool === 'image') {
            document.getElementById('imageLoader').click();
        }

        updateCursor();

        // Deselect when switching away from select tool
        if (currentTool !== 'select') {
            selectedId = null;
            renderScene();
        }
    });
});
document.getElementById('tool-pencil').classList.add('active');

/** Set canvas cursor based on active tool */
function updateCursor() {
    const cursors = {
        select:   'default',
        pan:      'grab',
        eraser:   'cell',
    };
    canvas.style.cursor = cursors[currentTool] || 'crosshair';
}
updateCursor();

// Color picker
const colorPicker = document.getElementById('color-picker');
colorPicker.addEventListener('input', (e) => {
    currentStrokeColor = e.target.value;
    syncColorSwatch(e.target.value);
    resetCanvasSettings();
});
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

/** Get canvas-relative position from any pointer event */
function getCoordinates(e) {
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
}

// ── 1. Pointer down ──────────────────────────────────────────
const startDrawing = (e) => {
    if (e.cancelable) e.preventDefault();
    if (currentTool === 'image') return;

    const screen = getCoordinates(e);

    // ── PAN ──
    if (currentTool === 'pan') {
        isPanning      = true;
        _panStartScreenX = screen.x;
        _panStartScreenY = screen.y;
        _panStartPanX  = panX;
        _panStartPanY  = panY;
        canvas.style.cursor = 'grabbing';
        return;
    }

    const world = screenToWorld(screen.x, screen.y);

    // ── SELECT ──
    if (currentTool === 'select') {
        const hit = hitTest(world.x, world.y);
        if (hit) {
            selectedId       = hit.id;
            isDragging       = true;
            dragStartWorldX  = world.x;
            dragStartWorldY  = world.y;
            dragOriginalData = JSON.parse(JSON.stringify(hit));
            canvas.style.cursor = 'move';
        } else {
            selectedId = null;
            isDragging = false;
        }
        renderScene();
        return;
    }

    // ── DRAW ──
    isDrawing = true;
    startX    = world.x;
    startY    = world.y;

    // Text: prompt immediately, no drag phase
    if (currentTool === 'text') {
        const text = prompt('Insert text:');
        if (text) {
            const obj = {
                id: generateId(), type: 'text',
                text, x0: startX, y0: startY,
                color: currentStrokeColor
            };
            scene.push(obj);
            renderScene();
            emitDrawAction(obj);
        }
        isDrawing = false;
        return;
    }

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        activeObject = {
            id:        generateId(),
            type:      currentTool,
            points:    [{ x: startX, y: startY }],
            color:     currentTool === 'eraser' ? '#000000' : currentStrokeColor,
            lineWidth: currentTool === 'eraser' ? 24 : currentLineWidth
        };
        scene.push(activeObject);
        // Emit the stroke-start so remote clients create the object
        emitDrawAction({ ...activeObject, _strokeStart: true });
    } else {
        // Shape tools
        activeObject = {
            id: generateId(), type: currentTool,
            x0: startX, y0: startY,
            x1: startX, y1: startY,
            color: currentStrokeColor, lineWidth: currentLineWidth
        };
        scene.push(activeObject);
    }
};

// ── 2. Pointer move ──────────────────────────────────────────
const draw = (e) => {
    if (e.cancelable) e.preventDefault();

    const screen = getCoordinates(e);

    // ── PAN ──
    if (isPanning) {
        panX = _panStartPanX + (screen.x - _panStartScreenX);
        panY = _panStartPanY + (screen.y - _panStartScreenY);
        renderScene();
        return;
    }

    const world = screenToWorld(screen.x, screen.y);

    // ── SELECT / DRAG ──
    if (currentTool === 'select' && isDragging && selectedId !== null) {
        const dx = world.x - dragStartWorldX;
        const dy = world.y - dragStartWorldY;
        applyMove(selectedId, dx, dy, dragOriginalData);
        renderScene();
        return;
    }

    if (!isDrawing || !activeObject) return;

    // ── PENCIL / ERASER — real-time point stream ──
    if (activeObject.type === 'pencil' || activeObject.type === 'eraser') {
        const pt = { x: world.x, y: world.y };
        activeObject.points.push(pt);
        renderScene();
        // Stream each new point to remote clients
        emitDrawAction({
            type: 'stroke-point',
            id:   activeObject.id,
            pt
        });
    } else {
        // Shape preview
        activeObject.x1 = world.x;
        activeObject.y1 = world.y;
        renderScene();
    }
};

// ── 3. Pointer up ────────────────────────────────────────────
const stopDrawing = (e) => {
    if (e.cancelable) e.preventDefault();

    // ── PAN end ──
    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = 'grab';
        return;
    }

    const screen = getCoordinates(e);
    const world  = screenToWorld(screen.x, screen.y);

    // ── SELECT / DRAG end ──
    if (currentTool === 'select' && isDragging && selectedId !== null) {
        isDragging = false;
        canvas.style.cursor = 'default';
        const dx = world.x - dragStartWorldX;
        const dy = world.y - dragStartWorldY;
        // Emit final absolute position to remote clients
        const movedObj = scene.find(o => o.id === selectedId);
        if (movedObj) emitMoveAction(movedObj);
        return;
    }

    if (!isDrawing || !activeObject) return;
    isDrawing = false;

    if (activeObject.type === 'pencil' || activeObject.type === 'eraser') {
        // Pencil stroke is already in scene; nothing extra needed
    } else {
        // Finalize shape coords
        activeObject.x1 = world.x;
        activeObject.y1 = world.y;
        emitDrawAction({ ...activeObject });
    }

    activeObject = null;
};

///////////////////////
// MOVE HELPER       ///
///////////////////////

/** Apply (dx, dy) offset relative to originalData snapshot */
function applyMove(id, dx, dy, originalData) {
    const obj = scene.find(o => o.id === id);
    if (!obj || !originalData) return;

    if (obj.type === 'pencil' || obj.type === 'eraser') {
        obj.points = originalData.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    } else if (obj.type === 'image') {
        obj.x = originalData.x + dx;
        obj.y = originalData.y + dy;
    } else {
        // text, line, square, circle, triangle
        obj.x0 = originalData.x0 + dx;
        obj.y0 = originalData.y0 + dy;
        if (originalData.x1 !== undefined) {
            obj.x1 = originalData.x1 + dx;
            obj.y1 = originalData.y1 + dy;
        }
    }
}

/////////////////////
// HIT TESTING    ///
/////////////////////

const HIT_THRESHOLD = 8;   // pixels

function hitTest(wx, wy) {
    for (let i = scene.length - 1; i >= 0; i--) {
        if (hitTestObject(scene[i], wx, wy)) return scene[i];
    }
    return null;
}

function hitTestObject(obj, wx, wy) {
    const t = Math.max((obj.lineWidth || 2) / 2, HIT_THRESHOLD);

    switch (obj.type) {
        case 'square': {
            const x0 = Math.min(obj.x0, obj.x1), x1 = Math.max(obj.x0, obj.x1);
            const y0 = Math.min(obj.y0, obj.y1), y1 = Math.max(obj.y0, obj.y1);
            // Near the border (not the interior)
            const inside = wx >= x0 - t && wx <= x1 + t && wy >= y0 - t && wy <= y1 + t;
            const onEdge  = wx <= x0 + t || wx >= x1 - t || wy <= y0 + t || wy >= y1 - t;
            return inside && onEdge;
        }
        case 'circle': {
            const r    = Math.hypot(obj.x1 - obj.x0, obj.y1 - obj.y0);
            const dist = Math.hypot(wx - obj.x0, wy - obj.y0);
            return Math.abs(dist - r) <= t;
        }
        case 'triangle': {
            // Use bounding box (simple, good enough for a triangle)
            const bbox = getObjectBBox(obj);
            if (!bbox) return false;
            return wx >= bbox.x - t && wx <= bbox.x + bbox.w + t
                && wy >= bbox.y - t && wy <= bbox.y + bbox.h + t;
        }
        case 'line':
            return segmentDist(wx, wy, obj.x0, obj.y0, obj.x1, obj.y1) <= t;

        case 'pencil':
        case 'eraser':
            if (!obj.points || obj.points.length < 2) return false;
            for (let i = 0; i < obj.points.length - 1; i++) {
                if (segmentDist(wx, wy,
                    obj.points[i].x, obj.points[i].y,
                    obj.points[i + 1].x, obj.points[i + 1].y) <= t) {
                    return true;
                }
            }
            return false;

        case 'text': {
            const bbox = getObjectBBox(obj);
            return bbox && wx >= bbox.x && wx <= bbox.x + bbox.w
                       && wy >= bbox.y && wy <= bbox.y + bbox.h;
        }
        case 'image':
            return wx >= obj.x && wx <= obj.x + obj.w
                && wy >= obj.y && wy <= obj.y + obj.h;

        default:
            return false;
    }
}

/** Shortest distance from point (px,py) to segment (ax,ay)→(bx,by) */
function segmentDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

////////////////////////////
// AUX EVENT LISTENERS   ///
////////////////////////////

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup',   stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);

canvas.addEventListener('touchstart',  startDrawing, { passive: false });
canvas.addEventListener('touchmove',   draw,         { passive: false });
canvas.addEventListener('touchend',    stopDrawing);
canvas.addEventListener('touchcancel', stopDrawing);

// Image loader
document.getElementById('imageLoader').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            const h = Math.round((200 * img.height) / img.width);
            const obj = {
                id: generateId(), type: 'image',
                dataUrl: event.target.result,
                // Place at canvas center in world-space
                x: Math.round(canvas.width  / 2 - 100) - panX,
                y: Math.round(canvas.height / 2 - h / 2) - panY,
                w: 200, h,
                _img: img
            };
            scene.push(obj);
            renderScene();
            const { _img: _, ...toSend } = obj;   // strip non-serializable _img
            emitDrawAction(toSend);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

////////////////////////////
// BOARD CONNECTION LOGIC //
////////////////////////////

function emitDrawAction(data) {
    data.roomId = ROOM_ID;
    socket.emit('draw-action', data);
}

function emitMoveAction(obj) {
    const { _img: _, ...toSend } = obj;
    socket.emit('move-action', { roomId: ROOM_ID, obj: toSend });
}

// Receive a draw action from a remote client
socket.on('draw-action', (data) => {
    // ── Full pencil/eraser stroke start ──
    if (data._strokeStart) {
        const obj = { ...data, _strokeStart: undefined };
        if (!scene.find(o => o.id === obj.id)) {
            scene.push(obj);
        }
        renderScene();
        return;
    }

    // ── Incremental stroke point ──
    if (data.type === 'stroke-point') {
        const obj = scene.find(o => o.id === data.id);
        if (obj) {
            obj.points.push(data.pt);
            renderScene();
        }
        return;
    }

    // ── Image: pre-load before inserting ──
    if (data.type === 'image') {
        if (scene.find(o => o.id === data.id)) return;
        const img = new Image();
        img.onload = () => { data._img = img; renderScene(); };
        img.src = data.dataUrl;
        scene.push(data);
        return;
    }

    // ── All other shapes / text ──
    if (!scene.find(o => o.id === data.id)) {
        scene.push(data);
        renderScene();
    }
});

// Receive a move action from a remote client — apply absolute final state
socket.on('move-action', (data) => {
    const idx = scene.findIndex(o => o.id === data.obj.id);
    if (idx === -1) return;
    // Preserve the cached _img on image objects
    const cached_img = scene[idx]._img;
    scene[idx] = { ...data.obj };
    if (cached_img) scene[idx]._img = cached_img;
    renderScene();
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
        console.warn('Mic access denied — audio disabled.');
    }
}

// Mute/unmute local mic
const localMicBtn = document.getElementById('local-mic-btn');
localMicBtn.addEventListener('click', () => {
    if (!localAudioStream) return;
    const track = localAudioStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    localMicBtn.classList.toggle('muted');
});

// Init WebRTC peer connection
function createPeerConnection(userId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] });

    localAudioStream.getTracks().forEach(track => pc.addTrack(track, localAudioStream));

    pc.ontrack = (event) => {
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

// Create UI for a remote user
function createUserUI(userId, stream) {
    const usersList = document.getElementById('users-list');

    const div = document.createElement('div');
    div.className = 'user-item';
    div.id = `user-${userId}`;

    const audioEl = document.createElement('audio');
    audioEl.srcObject = stream;
    audioEl.autoplay  = true;
    div.appendChild(audioEl);

    const hue  = (userId.charCodeAt(0) * 47 + userId.charCodeAt(1) * 13) % 360;
    const icon = document.createElement('span');
    icon.className = 'user-avatar';
    icon.style.setProperty('--avatar-hue', hue);
    icon.innerText = userId.substring(0, 1).toUpperCase();

    const speakerBtn = document.createElement('button');
    speakerBtn.className = 'audio-btn speaker-btn';
    speakerBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
    speakerBtn.title  = 'Silence user audio';
    speakerBtn.onclick = () => {
        audioEl.muted = !audioEl.muted;
        speakerBtn.classList.toggle('crossed');
    };

    const micBtn = document.createElement('button');
    micBtn.className = 'audio-btn mic-btn';
    micBtn.innerHTML  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
    micBtn.disabled   = true;

    const idSpan = document.createElement('span');
    idSpan.className = 'user-id';
    idSpan.innerText = userId.substring(0, 5);

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
    const pc    = createPeerConnection(userId);
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
    if (peers[userId]) { peers[userId].close(); delete peers[userId]; }
    const userUI = document.getElementById(`user-${userId}`);
    if (userUI) userUI.remove();
    updateUserCount();
});

// ---- Status badge ----
const statusBadge = document.getElementById('status-badge');
const statusText  = statusBadge ? statusBadge.querySelector('.status-text') : null;

socket.on('connect', () => {
    if (statusBadge) statusBadge.classList.add('connected');
    if (statusText)  statusText.textContent = 'Connected';
});

socket.on('disconnect', () => {
    if (statusBadge) statusBadge.classList.remove('connected');
    if (statusText)  statusText.textContent = 'Disconnected';
});

// ---- User count ----
function updateUserCount() {
    const userItems  = document.querySelectorAll('#users-list .user-item');
    const userCountEl = document.getElementById('user-count');
    if (userCountEl) userCountEl.innerText = userItems.length;
}

updateUserCount();
startAudio();