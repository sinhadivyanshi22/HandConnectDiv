/** 
 * =============================================
 * CONSTANTS & CONFIG
 * =============================================
 */
const PINCH_THRESHOLD = 0.05;          // 5% of screen distance
const LIGHTNING_DISTANCE = 150;         // px — max distance for lightning arcs
const PARTICLE_DECAY = 0.02;            // Per-frame life loss
const PARTICLE_GRAVITY = 0.1;           // Downward acceleration
const MAX_PARTICLES = 500;              // Hard cap to prevent memory leaks
const MAX_RIPPLES = 20;                 // Hard cap for shockwaves
const MAX_TRAIL_LENGTH = 25;            // Positions stored per fingertip trail
const ENERGY_ORB_MAX_DIST = 400;        // px — max palm distance for orb
const UI_UPDATE_INTERVAL = 250;         // ms — throttle DOM updates
const FINGER_TIPS = [4, 8, 12, 16, 20];

/**
 * =============================================
 * GLOBALS
 * =============================================
 */
const videoElement = document.querySelector('.input_video');
const bgCanvas = document.getElementById('bgCanvas');
const mainCanvas = document.getElementById('mainCanvas');
const bgCtx = bgCanvas.getContext('2d');
const ctx = mainCanvas.getContext('2d');

let width = window.innerWidth;
let height = window.innerHeight;

let time = 0;
let lastTime = performance.now();
let framesThisSecond = 0;
let lastFpsTime = performance.now();
let currentFPS = 0;

let currentHands = [];
let handVelocities = 0;

// Theme Config
let currentTheme = 'Rainbow';
const themes = {
    'Rainbow': (t, index, total) => `hsl(${(t * 100 + index * (360 / total)) % 360}, 100%, 60%)`,
    'Cyberpunk': (t, index, total) => (index % 2 === 0) ? '#ff003c' : '#00f0ff',
    'Lava': (t, index, total) => `hsl(${(10 + (index * 10)) % 40}, 100%, ${50 + Math.sin(t) * 10}%)`,
    'Ocean': (t, index, total) => `hsl(${180 + (index * 20)}, 100%, 60%)`,
    'Galaxy': (t, index, total) => `hsl(${260 + Math.sin(t * 2 + index) * 40}, 100%, 65%)`
};

// Physics
let particles = [];
let ripples = [];

// Finger trails: trails[handIndex][fingerIndex] = [{x, y}, ...]
let trails = [[], []];

// Matrix Background
let matrixColumns = [];
const fontSize = 16;
let maxColumns = 0;

// Theme-specific background state
let bgParticles = []; // For Lava embers, Ocean bubbles, Galaxy stars
const MAX_BG_PARTICLES = 80;

// Audio
let audioCtx = null;
let humOsc = null;
let humGain = null;
let masterGain = null;
let isMuted = false;

// UI Elements
const uiHands = document.getElementById('ui-hands');
const uiFps = document.getElementById('ui-fps');
const uiGesture = document.getElementById('ui-gesture');
const uiSpread = document.getElementById('ui-spread');

// UI update throttling
let lastUIUpdate = 0;
let pendingUIHands = 0;
let pendingUIGesture = 'None';
let pendingUISpread = '0%';

/**
 * =============================================
 * INITIALIZATION
 * =============================================
 */
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    bgCanvas.width = width;
    bgCanvas.height = height;
    mainCanvas.width = width;
    mainCanvas.height = height;

    maxColumns = Math.floor(width / fontSize);
    matrixColumns = new Array(maxColumns).fill(1).map(() => Math.random() * height / fontSize);
}
window.addEventListener('resize', resize);
resize();

// UI Theme Switcher
document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTheme = e.target.getAttribute('data-theme');
        document.documentElement.style.setProperty('--accent', themes[currentTheme](0, 1, 1));
        // Reset background particles when theme changes
        bgParticles = [];
    });
});

// Start button triggers AudioContext and hides overlay
document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startOverlay').classList.add('hidden');
    document.getElementById('loadingOverlay').classList.remove('hidden');
    initAudio();
    initMediaPipe();
});

// Retry button
document.getElementById('retryBtn').addEventListener('click', () => {
    document.getElementById('errorOverlay').classList.add('hidden');
    document.getElementById('loadingOverlay').classList.remove('hidden');
    initMediaPipe();
});

// Tutorial controls
document.getElementById('tutorialCloseBtn').addEventListener('click', () => {
    document.getElementById('tutorialOverlay').classList.add('hidden');
});

document.getElementById('tutorialBtn').addEventListener('click', () => {
    document.getElementById('tutorialOverlay').classList.remove('hidden');
});

// Mute toggle
document.getElementById('muteBtn').addEventListener('click', () => {
    isMuted = !isMuted;
    const icon = document.querySelector('#muteBtn .control-icon');
    if (isMuted) {
        icon.textContent = '🔇';
        if (masterGain) masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    } else {
        icon.textContent = '🔊';
        if (masterGain) masterGain.gain.setTargetAtTime(1, audioCtx.currentTime, 0.05);
    }
});

// Screenshot
document.getElementById('screenshotBtn').addEventListener('click', takeScreenshot);

// Fullscreen toggle
document.getElementById('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        document.querySelector('#fullscreenBtn .control-icon').textContent = '⊡';
    } else {
        document.exitFullscreen();
        document.querySelector('#fullscreenBtn .control-icon').textContent = '⛶';
    }
});

document.addEventListener('fullscreenchange', () => {
    const icon = document.querySelector('#fullscreenBtn .control-icon');
    icon.textContent = document.fullscreenElement ? '⊡' : '⛶';
});

/**
 * =============================================
 * SCREENSHOT
 * =============================================
 */
function takeScreenshot() {
    // Flash effect
    const flash = document.getElementById('screenshotFlash');
    flash.classList.add('flash');
    setTimeout(() => flash.classList.remove('flash'), 150);

    // Composite canvases
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw video frame (mirrored)
    tempCtx.save();
    tempCtx.translate(width, 0);
    tempCtx.scale(-1, 1);
    tempCtx.drawImage(videoElement, 0, 0, width, height);
    tempCtx.restore();

    // Draw background canvas
    tempCtx.drawImage(bgCanvas, 0, 0);
    // Draw main canvas
    tempCtx.drawImage(mainCanvas, 0, 0);

    // Download
    const link = document.createElement('a');
    link.download = `aura-ar-${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();

    // Show toast
    const toast = document.getElementById('screenshotToast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

/**
 * =============================================
 * AUDIO ENGINE
 * =============================================
 */
function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Master gain for mute control
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 1;
        masterGain.connect(audioCtx.destination);

        // Continuous Hum
        humOsc = audioCtx.createOscillator();
        humGain = audioCtx.createGain();

        humOsc.type = 'sine';
        humOsc.frequency.value = 100;

        humGain.gain.value = 0; // Mute until hands are seen

        humOsc.connect(humGain);
        humGain.connect(masterGain);
        humOsc.start();
    } catch (e) {
        console.error("Web Audio API failed", e);
    }
}

function triggerZap() {
    if (!audioCtx || isMuted) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    // Theme-specific zap profiles
    switch (currentTheme) {
        case 'Cyberpunk':
            osc.type = 'square';
            osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.08);
            break;
        case 'Ocean':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.2);
            break;
        case 'Lava':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.15);
            break;
        case 'Galaxy':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.25);
            break;
        default: // Rainbow
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
    }

    gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

    osc.connect(gainNode);
    gainNode.connect(masterGain);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
}

function updateHum(activeHands) {
    if (!audioCtx || !humGain) return;
    if (activeHands.length < 2) {
        humGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        return;
    }

    // Measure distance between index fingers to modulate volume
    const p1 = activeHands[0][8];
    const p2 = activeHands[1][8];
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // The closer they are, the higher the pitch and volume
    const targetFreq = 100 + (1 - Math.min(dist, 1)) * 300;
    const targetVolume = 0.05 + (1 - Math.min(dist, 1)) * 0.15;

    humOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
    humGain.gain.setTargetAtTime(targetVolume, audioCtx.currentTime, 0.1);
}

/**
 * =============================================
 * MATH & STATE LOGIC
 * =============================================
 */
function getDist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Convert normalized landmark to canvas coords (canvas is horizontally flipped)
function mapToCanvas(point) {
    return { x: point.x * width, y: point.y * height };
}

let lastPinchState = [false, false];

function detectGestures() {
    if (!currentHands.length) return;

    currentHands.forEach((hand, idx) => {
        // Pinch Detection: Thumb (4) and Index (8)
        const thumb = hand[4];
        const index = hand[8];
        const dist = getDist(thumb, index);

        const isPinching = dist < PINCH_THRESHOLD;

        if (isPinching && !lastPinchState[idx]) {
            const midpoint = {
                x: (thumb.x + index.x) / 2,
                y: (thumb.y + index.y) / 2
            };
            createShockwave(mapToCanvas(midpoint), themes[currentTheme](time, 1, 1));
            triggerZap();
            pendingUIGesture = "PINCH !";
        }
        lastPinchState[idx] = isPinching;
    });

    // Spread Percentage roughly estimated by distance from Index(8) to Pinky(20)
    if (currentHands[0]) {
        const spread = getDist(currentHands[0][8], currentHands[0][20]);
        let spreadPct = Math.min(Math.round(spread * 300), 100);
        pendingUISpread = spreadPct + '%';
        if (!lastPinchState.includes(true)) {
            pendingUIGesture = spreadPct > 50 ? "Open Hand" : "Fist";
        }
    }
}

/**
 * =============================================
 * EFFECTS & PHYSICS
 * =============================================
 */
function createParticles(pos, color, count = 3) {
    if (particles.length >= MAX_PARTICLES) return; // Memory guard
    for (let i = 0; i < count; i++) {
        particles.push({
            x: pos.x,
            y: pos.y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 1.0,
            color: color,
            size: Math.random() * 3 + 1
        });
    }
}

function createShockwave(pos, color) {
    if (ripples.length >= MAX_RIPPLES) ripples.shift(); // Evict oldest
    ripples.push({
        x: pos.x,
        y: pos.y,
        radius: 0,
        maxRadius: 150 + Math.random() * 100,
        life: 1.0,
        color: color
    });
}

/**
 * =============================================
 * FINGER TRAIL SYSTEM
 * =============================================
 */
function updateTrails() {
    currentHands.forEach((hand, handIndex) => {
        if (!trails[handIndex]) trails[handIndex] = [];
        FINGER_TIPS.forEach((tipIndex, fingerIdx) => {
            if (!trails[handIndex][fingerIdx]) trails[handIndex][fingerIdx] = [];
            const pt = mapToCanvas(hand[tipIndex]);
            trails[handIndex][fingerIdx].push({ x: pt.x, y: pt.y });
            if (trails[handIndex][fingerIdx].length > MAX_TRAIL_LENGTH) {
                trails[handIndex][fingerIdx].shift();
            }
        });
    });
    // Clear trails for hands no longer present
    for (let i = currentHands.length; i < 2; i++) {
        if (trails[i]) {
            trails[i].forEach(trail => {
                if (trail && trail.length > 0) trail.shift(); // Fade out gracefully
            });
        }
    }
}

function drawTrails() {
    trails.forEach((handTrails, handIndex) => {
        if (!handTrails) return;
        handTrails.forEach((trail, fingerIdx) => {
            if (!trail || trail.length < 3) return;
            const col = themes[currentTheme](time, fingerIdx, FINGER_TIPS.length);

            // Draw tapered ribbon using segments with increasing width & opacity
            for (let i = 1; i < trail.length; i++) {
                const alpha = i / trail.length;
                const lineWidth = alpha * 5;

                ctx.beginPath();
                ctx.moveTo(trail[i - 1].x, trail[i - 1].y);

                // Smooth curve using quadratic bezier
                if (i < trail.length - 1) {
                    const midX = (trail[i].x + trail[i + 1].x) / 2;
                    const midY = (trail[i].y + trail[i + 1].y) / 2;
                    ctx.quadraticCurveTo(trail[i].x, trail[i].y, midX, midY);
                } else {
                    ctx.lineTo(trail[i].x, trail[i].y);
                }

                ctx.strokeStyle = col;
                ctx.lineWidth = lineWidth;
                ctx.globalAlpha = alpha * 0.6;
                ctx.shadowBlur = 12;
                ctx.shadowColor = col;
                ctx.lineCap = 'round';
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        });
    });
}

/**
 * =============================================
 * ENERGY ORB (two-hand effect)
 * =============================================
 */
function drawEnergyOrb() {
    if (currentHands.length < 2) return;

    const palm1 = mapToCanvas(currentHands[0][0]);
    const palm2 = mapToCanvas(currentHands[1][0]);

    const midX = (palm1.x + palm2.x) / 2;
    const midY = (palm1.y + palm2.y) / 2;
    const dist = getDist(palm1, palm2);

    if (dist > ENERGY_ORB_MAX_DIST) return;

    const intensity = 1 - Math.min(dist / ENERGY_ORB_MAX_DIST, 1);
    const orbRadius = 15 + intensity * 70;
    const pulseRadius = orbRadius + Math.sin(time * 8) * 10 * intensity;
    const themeColor = themes[currentTheme](time, 0, 1);

    ctx.save();

    // Outer glow layers
    for (let layer = 3; layer >= 0; layer--) {
        const r = pulseRadius * (1.5 + layer * 0.8);
        const alpha = intensity * 0.08 * (4 - layer);

        ctx.beginPath();
        ctx.arc(midX, midY, r, 0, Math.PI * 2);
        ctx.fillStyle = themeColor;
        ctx.globalAlpha = alpha;
        ctx.fill();
    }

    // Core orb — white center
    const coreGrad = ctx.createRadialGradient(midX, midY, 0, midX, midY, pulseRadius);
    coreGrad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * intensity})`);
    coreGrad.addColorStop(0.4, `rgba(255, 255, 255, ${0.3 * intensity})`);
    coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.beginPath();
    ctx.arc(midX, midY, pulseRadius, 0, Math.PI * 2);
    ctx.fillStyle = coreGrad;
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 50 * intensity;
    ctx.shadowColor = themeColor;
    ctx.fill();

    // Spark particles around orb
    if (intensity > 0.3 && Math.random() > 0.5) {
        const angle = Math.random() * Math.PI * 2;
        const sparkDist = pulseRadius * (0.8 + Math.random() * 0.5);
        createParticles({
            x: midX + Math.cos(angle) * sparkDist,
            y: midY + Math.sin(angle) * sparkDist
        }, themeColor, 1);
    }

    ctx.restore();
}

/**
 * =============================================
 * PER-FINGER AURA GLOW
 * =============================================
 */
function drawFingerAura(pt, color) {
    ctx.save();
    // Outer volumetric glow — multiple layers
    for (let i = 3; i >= 0; i--) {
        const r = 6 + i * 6;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.08 * (4 - i);
        ctx.fill();
    }
    // Bright center
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 25;
    ctx.shadowColor = color;
    ctx.fill();
    ctx.restore();
}

/**
 * =============================================
 * THEME-SPECIFIC BACKGROUNDS
 * =============================================
 */
function spawnBgParticle() {
    if (bgParticles.length >= MAX_BG_PARTICLES) return;

    switch (currentTheme) {
        case 'Lava':
            bgParticles.push({
                x: Math.random() * width,
                y: height + 10,
                vx: (Math.random() - 0.5) * 0.5,
                vy: -(1 + Math.random() * 2),
                life: 1.0,
                size: 2 + Math.random() * 3,
                type: 'ember'
            });
            break;
        case 'Ocean':
            bgParticles.push({
                x: Math.random() * width,
                y: height + 10,
                vx: (Math.random() - 0.5) * 0.3,
                vy: -(0.3 + Math.random() * 0.8),
                life: 1.0,
                size: 3 + Math.random() * 5,
                type: 'bubble'
            });
            break;
        case 'Galaxy':
            bgParticles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: 0,
                vy: 0,
                life: 0.5 + Math.random() * 0.5,
                size: 1 + Math.random() * 2,
                type: 'star',
                twinkleSpeed: 2 + Math.random() * 4
            });
            break;
        case 'Cyberpunk':
            // Horizontal scan line
            bgParticles.push({
                x: 0,
                y: Math.random() * height,
                vx: 0,
                vy: 1 + Math.random() * 2,
                life: 1.0,
                size: 1,
                type: 'scanline'
            });
            break;
    }
}

function drawThemeBackground() {
    // Spawn new background particles periodically
    if (Math.random() > 0.85) spawnBgParticle();

    for (let i = bgParticles.length - 1; i >= 0; i--) {
        const p = bgParticles[i];
        p.x += p.vx;
        p.y += p.vy;

        switch (p.type) {
            case 'ember':
                p.life -= 0.008;
                p.vx += (Math.random() - 0.5) * 0.1; // Drift
                bgCtx.beginPath();
                bgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                bgCtx.fillStyle = `rgba(255, ${80 + Math.random() * 80}, 0, ${p.life * 0.7})`;
                bgCtx.shadowBlur = 10;
                bgCtx.shadowColor = '#ff4400';
                bgCtx.fill();
                bgCtx.shadowBlur = 0;
                break;

            case 'bubble':
                p.life -= 0.004;
                p.vx += (Math.random() - 0.5) * 0.05;
                bgCtx.beginPath();
                bgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                bgCtx.strokeStyle = `rgba(100, 200, 255, ${p.life * 0.4})`;
                bgCtx.lineWidth = 1;
                bgCtx.stroke();
                // Highlight
                bgCtx.beginPath();
                bgCtx.arc(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.25, 0, Math.PI * 2);
                bgCtx.fillStyle = `rgba(255, 255, 255, ${p.life * 0.3})`;
                bgCtx.fill();
                break;

            case 'star':
                const twinkle = Math.sin(time * p.twinkleSpeed) * 0.5 + 0.5;
                p.life -= 0.002;
                bgCtx.beginPath();
                bgCtx.arc(p.x, p.y, p.size * twinkle, 0, Math.PI * 2);
                bgCtx.fillStyle = `rgba(200, 180, 255, ${p.life * twinkle})`;
                bgCtx.shadowBlur = 6;
                bgCtx.shadowColor = 'rgba(180, 120, 255, 0.5)';
                bgCtx.fill();
                bgCtx.shadowBlur = 0;
                break;

            case 'scanline':
                p.life -= 0.015;
                bgCtx.beginPath();
                bgCtx.moveTo(0, p.y);
                bgCtx.lineTo(width, p.y);
                bgCtx.strokeStyle = `rgba(255, 0, 60, ${p.life * 0.15})`;
                bgCtx.lineWidth = 1;
                bgCtx.stroke();
                break;
        }

        if (p.life <= 0 || p.y < -20) {
            bgParticles.splice(i, 1);
        }
    }

    // Cyberpunk: subtle grid overlay
    if (currentTheme === 'Cyberpunk') {
        bgCtx.strokeStyle = 'rgba(0, 240, 255, 0.03)';
        bgCtx.lineWidth = 1;
        const gridSize = 60;
        for (let x = 0; x < width; x += gridSize) {
            bgCtx.beginPath();
            bgCtx.moveTo(x, 0);
            bgCtx.lineTo(x, height);
            bgCtx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
            bgCtx.beginPath();
            bgCtx.moveTo(0, y);
            bgCtx.lineTo(width, y);
            bgCtx.stroke();
        }
    }
}

// Background Effect Engine (Matrix rain — always on but lighter for non-Rainbow themes)
function drawBackground() {
    // Fade previous frame
    bgCtx.globalCompositeOperation = 'destination-out';
    bgCtx.fillStyle = `rgba(0, 0, 0, ${0.15 + Math.min(handVelocities * 10, 0.5)})`;
    bgCtx.fillRect(0, 0, width, height);
    bgCtx.globalCompositeOperation = 'source-over';

    // Matrix Rain — intensity varies by theme
    const matrixIntensity = (currentTheme === 'Rainbow' || currentTheme === 'Cyberpunk') ? 0.95 : 0.98;

    bgCtx.fillStyle = themes[currentTheme](time, 1, 1);
    bgCtx.font = fontSize + "px monospace";

    let speedMult = 1 + (handVelocities * 100);

    for (let i = 0; i < matrixColumns.length; i++) {
        if (Math.random() > matrixIntensity) {
            const char = String.fromCharCode(0x30A0 + Math.random() * 96);
            bgCtx.fillText(char, i * fontSize, matrixColumns[i] * fontSize);
        }

        matrixColumns[i] += Math.random() * speedMult;

        if (matrixColumns[i] * fontSize > height && Math.random() > 0.9) {
            matrixColumns[i] = 0;
        }
    }

    // Draw theme-specific background effects
    drawThemeBackground();
}

function updatePhysics() {
    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= PARTICLE_DECAY;
        p.vy += PARTICLE_GRAVITY;

        if (p.life <= 0) {
            particles.splice(i, 1);
        } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.fill();
        }
    }

    // Ripples / Shockwaves
    for (let i = ripples.length - 1; i >= 0; i--) {
        let r = ripples[i];
        r.radius += (r.maxRadius - r.radius) * 0.1; // Ease out
        r.life -= 0.03;

        if (r.life <= 0) {
            ripples.splice(i, 1);
        } else {
            // Double ring for richer shockwave
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
            ctx.strokeStyle = r.color;
            ctx.lineWidth = 4 * r.life;
            ctx.globalAlpha = r.life;
            ctx.stroke();

            // Inner ring
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius * 0.6, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * r.life;
            ctx.globalAlpha = r.life * 0.5;
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1.0;
}

/**
 * =============================================
 * THROTTLED UI UPDATES
 * =============================================
 */
function updateUI(timestamp) {
    if (timestamp - lastUIUpdate < UI_UPDATE_INTERVAL) return;
    lastUIUpdate = timestamp;

    uiHands.innerText = pendingUIHands;
    uiFps.innerText = currentFPS;
    uiGesture.innerText = pendingUIGesture;
    uiSpread.innerText = pendingUISpread;
}

/**
 * =============================================
 * MAIN RENDER PIPELINE
 * =============================================
 */
function renderLoop(timestamp) {
    requestAnimationFrame(renderLoop);

    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    time += dt;

    // Update FPS Counter
    framesThisSecond++;
    if (timestamp > lastFpsTime + 1000) {
        currentFPS = framesThisSecond;
        framesThisSecond = 0;
        lastFpsTime = timestamp;
    }

    drawBackground();

    // Fade main canvas for trailing motion blur
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    // Enable Screen mode for additive light effects (neon bloom)
    ctx.globalCompositeOperation = 'screen';

    // Render Physics layer
    updatePhysics();

    // Process Hand Logic if present
    if (currentHands.length > 0) {

        // Update finger trails
        updateTrails();

        // Draw finger trails (ribbon effect)
        drawTrails();

        // 1. Draw Skeleton
        currentHands.forEach((hand, handIndex) => {
            const glowColor = themes[currentTheme](time, handIndex, 2);

            // Draw MediaPipe skeleton connectors
            drawConnectors(ctx, hand, HAND_CONNECTIONS, {
                color: glowColor,
                lineWidth: 2
            });

            // Fingertip rendering with enhanced aura
            ctx.shadowBlur = 15;
            ctx.shadowColor = glowColor;

            FINGER_TIPS.forEach((tipIndex, idx) => {
                const pt = mapToCanvas(hand[tipIndex]);
                const tipCol = themes[currentTheme](time, idx, FINGER_TIPS.length);

                // Enhanced per-finger aura glow
                drawFingerAura(pt, tipCol);

                // Spark particles at fingertips
                if (Math.random() > 0.6) {
                    createParticles(pt, tipCol, 1);
                }
            });
            ctx.shadowBlur = 0;
        });

        // 2. Energy Orb between palms
        drawEnergyOrb();

        // 3. Cross-Hand Interactions (Lightning & Gradients)
        if (currentHands.length >= 2) {
            const h1 = currentHands[0];
            const h2 = currentHands[1];

            // A. Rainbow Connecting Lines
            FINGER_TIPS.forEach((tipIndex, idx) => {
                const pt1 = mapToCanvas(h1[tipIndex]);
                const pt2 = mapToCanvas(h2[tipIndex]);
                const dist = getDist(pt1, pt2);

                const col = themes[currentTheme](time, idx, FINGER_TIPS.length);

                // Lightning electric arc when very close
                if (dist < LIGHTNING_DISTANCE && Math.random() > 0.5) {
                    ctx.beginPath();
                    ctx.moveTo(pt1.x, pt1.y);
                    // Multiple segments for more realistic lightning
                    const segments = 3;
                    let prevX = pt1.x, prevY = pt1.y;
                    for (let s = 1; s <= segments; s++) {
                        const t = s / (segments + 1);
                        const jitterX = (pt1.x + (pt2.x - pt1.x) * t) + (Math.random() - 0.5) * 50;
                        const jitterY = (pt1.y + (pt2.y - pt1.y) * t) + (Math.random() - 0.5) * 50;
                        ctx.lineTo(jitterX, jitterY);
                        prevX = jitterX;
                        prevY = jitterY;
                    }
                    ctx.lineTo(pt2.x, pt2.y);

                    ctx.strokeStyle = '#ffffff';
                    ctx.shadowBlur = 20;
                    ctx.shadowColor = col;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }

                // Normal flowing gradient line
                ctx.beginPath();
                ctx.moveTo(pt1.x, pt1.y);
                ctx.lineTo(pt2.x, pt2.y);

                let grad = ctx.createLinearGradient(pt1.x, pt1.y, pt2.x, pt2.y);
                grad.addColorStop(0, themes[currentTheme](time, idx, 5));
                grad.addColorStop(0.5, themes[currentTheme](time, idx + 1, 5));
                grad.addColorStop(1, themes[currentTheme](time, idx + 2, 5));

                ctx.strokeStyle = grad;
                ctx.lineWidth = 4;
                ctx.shadowBlur = 10;
                ctx.shadowColor = col;
                ctx.stroke();
                ctx.shadowBlur = 0;
            });

            // B. Mandala drawing — connecting all 10 fingertips in a star
            if (h1 && h2) {
                let allTips = FINGER_TIPS.map(t => mapToCanvas(h1[t])).concat(
                    FINGER_TIPS.map(t => mapToCanvas(h2[t])));

                ctx.save();
                let cx = allTips.reduce((sum, p) => sum + p.x, 0) / 10;
                let cy = allTips.reduce((sum, p) => sum + p.y, 0) / 10;

                ctx.translate(cx, cy);
                ctx.rotate(time * 0.5);

                ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    const t1 = { x: allTips[i].x - cx, y: allTips[i].y - cy };
                    const t2 = { x: allTips[(i + 3) % 10].x - cx, y: allTips[(i + 3) % 10].y - cy };
                    ctx.moveTo(t1.x, t1.y);
                    ctx.lineTo(t2.x, t2.y);
                }
                ctx.strokeStyle = `rgba(255, 255, 255, 0.2)`;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            }
        }

        detectGestures();
    } else {
        // Clear trails when no hands detected
        updateTrails();
    }

    ctx.globalCompositeOperation = 'source-over'; // Restore

    // Throttled UI update
    updateUI(timestamp);
}

/**
 * =============================================
 * MEDIAPIPE INITIALIZATION
 * =============================================
 */
function onTrackingReady() {
    // Hide loading, show UI
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('themes').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');

    // Show tutorial on first launch
    document.getElementById('tutorialOverlay').classList.remove('hidden');

    requestAnimationFrame(renderLoop);
}

function initMediaPipe() {
    const hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    let firstResult = true;

    hands.onResults((results) => {
        if (!audioCtx) return;

        // First result means model is loaded — hide loading
        if (firstResult) {
            firstResult = false;
            onTrackingReady();
        }

        // Update state
        pendingUIHands = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;

        // Calculate velocity
        if (currentHands.length > 0 && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            let vSum = 0;
            const oldP = currentHands[0][8];
            const newP = results.multiHandLandmarks[0][8];
            if (oldP && newP) {
                vSum += getDist(oldP, newP);
                handVelocities = vSum;
            }
        } else {
            handVelocities = 0;
        }

        currentHands = results.multiHandLandmarks || [];
        updateHum(currentHands);
    });

    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({ image: videoElement });
        },
        width: 1280,
        height: 720,
        facingMode: 'user'
    });

    camera.start().catch(err => {
        console.error("Camera access denied or failed:", err);
        document.getElementById('loadingOverlay').classList.add('hidden');
        document.getElementById('errorOverlay').classList.remove('hidden');
    });
}
