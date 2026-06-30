
        /* ── UTILITY ── */
        const $ = id => document.getElementById(id);
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        let stepDelay = 1900;
        let running = false;
        let stepMode = false;
        let stepResolve = null;
        let currentStep = -1;
        let logTime = 0;
        let compareVisible = false;

        /* ── RAM CELLS ── */
        const RAM_SIZE = 8;
        const ramState = Array(RAM_SIZE).fill('--');
        function renderRAM() {
            const c = $('ramCells');
            c.innerHTML = ramState.map((v, i) =>
                `<div id="rc${i}" style="background:${v === '--' ? 'var(--surface2)' : '#0d2a1a'};
    border:1px solid ${v === '--' ? 'var(--border)' : 'var(--ram)'};
    border-radius:4px;padding:4px;text-align:center;
    font-family:var(--mono);font-size:10px;
    color:${v === '--' ? 'var(--text-dim)' : 'var(--ram)'};
    transition:all 0.3s">${v === '--' ? 'M' + i : '<b>' + v + '</b>'}</div>`
  ).join('');
}
renderRAM();

/* ── LOG ── */
function log(src, msg) {
  logTime++;
  const ts = String(logTime).padStart(2,'0')+':'+String(Math.floor(Math.random()*59)).padStart(2,'0');
  const p = $('logPanel');
  const e = document.createElement('div');
  e.className = 'log-entry';
  e.innerHTML = `<span class="log-ts">${ts}</span><span class="log-src ${src}">${src.toUpperCase()}</span><span class="log-msg">${msg}</span>`;
  p.appendChild(e);
  p.scrollTop = p.scrollHeight;
}

/* ── PIN HIGHLIGHT ── */
function flashPin(id, dur=1600) {
  const el = $(id);
  if (!el) return;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), dur);
}

/* ── BUS ANIMATE ── */
function flowBus(id, times=1) {
  const el = $(id);
  if (!el) return Promise.resolve();
  return new Promise(res => {
    let count = 0;
    function go() {
      el.classList.remove('flowing');
      void el.offsetWidth;
      el.classList.add('flowing');
      count++;
      if (count < times) {
        el.addEventListener('animationend', function h() {
          el.removeEventListener('animationend', h);
          setTimeout(go, 80);
        });
      } else {
        el.addEventListener('animationend', function h() {
          el.removeEventListener('animationend', h);
          res();
        });
      }
    }
    go();
  });
}

/* ── COMPONENT PULSE ── */
function pulseComp(id, colorClass) {
  const el = $(id);
  if (!el) return;
  el.classList.add('pulse', `active-comp-${colorClass}`);
  setTimeout(() => {
    el.classList.remove('pulse');
    setTimeout(() => el.classList.remove(`active-comp-${colorClass}`), 1500);
  }, 500);
}

/* ── STEP TRACK ── */
function setStep(n) {
  currentStep = n;
  document.querySelectorAll('.step-item').forEach((el, i) => {
    el.classList.remove('current','done');
    if (i < n) el.classList.add('done');
    if (i === n) el.classList.add('current');
  });
}

/* ── DMA STATUS ── */
function setDMAStatus(txt, color='var(--dma)') {
  $('dmaStatus').textContent = txt;
  $('dmaStatus').style.color = color;
}

/* ── STEP GATE ── */
async function gate() {
  if (stepMode) {
    await new Promise(res => { stepResolve = res; });
  } else {
    await sleep(stepDelay);
  }
}

/* ── MAIN ANIMATION SEQUENCE ── */
async function runDMA() {
  if (running) return;
  running = true;
  $('btnPlay').disabled = true;
  $('btnStep').disabled = !stepMode;
  $('btnStep').textContent = stepMode ? '⏭️ Next Step' : '⏭️ Step Through';

  // Reset
  ramState.fill('--'); renderRAM();
  setDMAStatus('IDLE');
  $('ioData').textContent = '[ A0 B1 C2 D3 E4 F5 G6 H7 ]';
  $('ioData').style.color = 'var(--io)';

  const bytes = ['A0','B1','C2','D3','E4','F5','G6','H7'];

  /* ── STEP 0: CPU programs DMA ── */
  setStep(0);
  log('cpu', 'Starting I/O read. Programming DMA controller with source address, destination, and byte count.');
  pulseComp('compCPU','cpu');
  flashPin('pin-rw-cpu'); flashPin('pin-addr-cpu'); flashPin('pin-data-cpu');
  await gate();
  await flowBus('busAddr'); 
  await flowBus('busData');
  log('dma', 'Registers loaded: SRC=I/O_BASE, DST=0x1000, COUNT=8');
  pulseComp('compDMA','dma');
  setDMAStatus('PROGRAMMED');
  await gate();

  /* ── STEP 1: DMA requests bus ── */
  setStep(1);
  log('dma', 'Asserting BR (Bus Request) → CPU...');
  flashPin('pin-br-dma'); flashPin('pin-br');
  await flowBus('busDmaReq',2);
  await gate();
  log('cpu', 'BG (Bus Grant) asserted. CPU releasing bus and entering hold state.');
  flashPin('pin-bg'); flashPin('pin-bg-dma');
  pulseComp('compCPU','cpu');
  pulseComp('compDMA','dma');
  await flowBus('busAddr');
  setDMAStatus('BUS MASTER');
  log('sys', 'DMA controller now owns the address/data/control buses.');
  await gate();

  /* ── STEPS 2+3: Transfer each byte ── */
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];

    /* I/O → DMA */
    setStep(2);
    log('io', `DMA_REQ: byte [${byte}] ready on I/O data lines.`);
    flashPin('pin-dma-req');
    pulseComp('compIO','io');
    await flowBus('busDmaReq');
    await gate();

    log('dma', `DMA_ACK sent. Reading byte ${byte} from I/O device.`);
    flashPin('pin-dma-ack'); flashPin('pin-rw-dma'); flashPin('pin-data-dma');
    pulseComp('compDMA','dma');
    await flowBus('busDmaAck');
    setDMAStatus(`RD ${byte}`);
    await gate();

    /* DMA → RAM */
    setStep(3);
    log('dma', `Writing byte ${byte} to RAM address 0x${(0x1000 + i * 4).toString(16).toUpperCase()}.`);
    flashPin('pin-rw-ram'); flashPin('pin-addr-ram'); flashPin('pin-data-ram');
    await flowBus('busAddr');
    await flowBus('busData');
    await flowBus('busWrCtrl');
    pulseComp('compRAM','ram');
    setDMAStatus(`WR ${byte} → RAM`);
    ramState[i] = byte;
    renderRAM();
    // flash the new cell
    setTimeout(() => {
      const cell = $(`rc${i}`);
      if (cell) { cell.style.transform = 'scale(1.2)'; setTimeout(() => cell.style.transform = '', 300); }
    }, 100);
    await gate();
  }

  /* ── STEP 4: DMA fires interrupt ── */
  setStep(4);
  setDMAStatus('COMPLETE');
  log('dma', 'All 8 bytes transferred. Asserting INTERRUPT to CPU.');
  flashPin('pin-int-dma'); flashPin('pin-int-cpu');
  pulseComp('compDMA','dma');
  await flowBus('busIRQ', 3);
  $('ioData').textContent = '[ -- -- -- -- -- -- -- -- ]';
  $('ioData').style.color = 'var(--text-dim)';
  await gate();

  /* ── STEP 5: CPU resumes ── */
  setStep(5);
  log('cpu', 'Interrupt received! Entering ISR: transfer complete, 8 bytes at 0x1000.');
  pulseComp('compCPU','cpu');
  flashPin('pin-int-cpu');
  await flowBus('busIRQ');
  await gate();
  log('cpu', 'ISR done. Bus control restored. CPU resumes normal execution.');
  setDMAStatus('IDLE');
  await flowBus('busAddr');
  pulseComp('compCPU','cpu');
  await gate();

  log('sys', '✓ DMA transfer complete. 8 bytes in RAM. CPU was free during entire transfer.');
  running = false;
  $('btnPlay').disabled = false;
  $('btnStep').disabled = false;
  $('btnStep').textContent = '⏭️ Step Through';
  stepMode = false;
  $('btnStep').classList.remove('active');
}

/* ── BUTTONS ── */
$('btnPlay').addEventListener('click', () => {
  stepMode = false;
  $('btnStep').classList.remove('active');
  runDMA();
});

$('btnStep').addEventListener('click', () => {
  if (!running) {
    stepMode = true;
    $('btnStep').classList.add('active');
    $('btnStep').textContent = '⏭️ Next Step';
    runDMA();
  } else if (stepResolve) {
    const res = stepResolve;
    stepResolve = null;
    res();
  }
});

$('btnReset').addEventListener('click', () => {
  if (running) {
    running = false;
    stepResolve && stepResolve();
    stepResolve = null;
  }
  stepMode = false;
  currentStep = -1;
  $('btnStep').classList.remove('active');
  $('btnStep').textContent = '⏭️ Step Through';
  $('btnPlay').disabled = false;
  $('btnStep').disabled = false;
  document.querySelectorAll('.step-item').forEach(e => e.classList.remove('current','done'));
  ramState.fill('--'); renderRAM();
  setDMAStatus('IDLE');
  $('ioData').textContent = '[ A0 B1 C2 D3 E4 F5 G6 H7 ]';
  $('ioData').style.color = 'var(--io)';
  $('logPanel').innerHTML = '<div class="log-entry"><span class="log-ts">00:00</span><span class="log-src sys">SYS</span><span class="log-msg">Reset. Ready for new transfer.</span></div>';
  logTime = 0;
  document.querySelectorAll('.pin').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.comp').forEach(c => {
    c.classList.remove('active-comp-cpu','active-comp-ram','active-comp-dma','active-comp-io','pulse');
  });
});

$('btnCompare').addEventListener('click', () => {
  compareVisible = !compareVisible;
  $('compareSection').style.display = compareVisible ? 'block' : 'none';
  $('btnCompare').textContent = compareVisible ? '✕ Hide Comparison' : '⚡ CPU vs DMA';
  if (compareVisible) {
    setTimeout(() => {
      $('barCPU').style.width = '22%'; $('barCPU').nextElementSibling && ($('barCPU').parentElement.nextElementSibling.textContent = '110 MB/s');
      $('barDMA').style.width = '88%';
      $('barFree').style.width = '78%';
    }, 100);
    const cpuVal = document.querySelector('#speedRow .speed-card:nth-child(1) .speed-val');
    const dmaVal = document.querySelector('#speedRow .speed-card:nth-child(2) .speed-val');
    const freeVal = document.querySelector('#speedRow .speed-card:nth-child(3) .speed-val');
    setTimeout(() => {
      if (cpuVal)  animateValue(cpuVal, 0, 110, 1400, v => v+' MB/s');
      if (dmaVal)  animateValue(dmaVal, 0, 4400, 1400, v => v+' MB/s');
      if (freeVal) animateValue(freeVal, 0, 92, 1400, v => v+'%');
      $('barCPU').style.width = '22%';
      $('barDMA').style.width = '88%';
      $('barFree').style.width = '78%';
    }, 200);
  }
});

let speedFast = false;
$('btnSpeed').addEventListener('click', () => {
  speedFast = !speedFast;
  stepDelay = speedFast ? 350 : 900;
  $('btnSpeed').textContent = `↕️ Speed: ${speedFast ? 'Fast' : 'Normal'}`;
});

function animateValue(el, from, to, dur, fmt) {
  const start = Date.now();
  function tick() {
    const p = Math.min((Date.now()-start)/dur, 1);
    el.textContent = fmt(Math.round(from + (to-from)*p));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ── STEP CLICK (manual navigation info) ── */
document.querySelectorAll('.step-item').forEach((el,i) => {
  el.title = 'Click ▶️ or ⏭️ to animate through steps';
});

/* ── INITIAL LOG ── */
log('sys', 'Simulation loaded. I/O device has 8 bytes ready to transfer to RAM.');
log('cpu', 'CPU is busy running userspace processes. DMA request is pending...');
    