/* PB — a small, offline-only challenge timer. All state lives in localStorage. */
(function () {
  'use strict';

  const STORAGE_KEY = 'pb-race-data';
  const DATA_VERSION = 1;
  const HISTORY_LIMIT = 8;

  const el = {
    homeView: document.getElementById('homeView'),
    timerView: document.getElementById('timerView'),
    homeButton: document.getElementById('homeButton'),
    settingsButton: document.getElementById('settingsButton'),
    challengeList: document.getElementById('challengeList'),
    createChallengeButton: document.getElementById('createChallengeButton'),
    privacyButton: document.getElementById('privacyButton'),
    backButton: document.getElementById('backButton'),
    timerEmoji: document.getElementById('timerEmoji'),
    timerTitle: document.getElementById('timerTitle'),
    editChallengeButton: document.getElementById('editChallengeButton'),
    standardBlock: document.getElementById('standardBlock'),
    standardText: document.getElementById('standardText'),
    pbTime: document.getElementById('pbTime'),
    lastTime: document.getElementById('lastTime'),
    timerStatus: document.getElementById('timerStatus'),
    timerDisplay: document.getElementById('timerDisplay'),
    timerActionButton: document.getElementById('timerActionButton'),
    timerHint: document.getElementById('timerHint'),
    historyList: document.getElementById('historyList'),
    modalRoot: document.getElementById('modalRoot'),
    importInput: document.getElementById('importInput')
  };

  let state = loadState();
  let currentChallengeId = null;
  let tickHandle = null;
  let modalCloseHandler = null;

  function freshState() {
    return { version: DATA_VERSION, challenges: [], activeTimer: null };
  }

  function isFiniteTimestamp(value) {
    return Number.isFinite(value) && value > 0;
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== 'object' || !Number.isFinite(record.durationMs) || record.durationMs < 0 || !isFiniteTimestamp(record.completedAt)) return null;
    return {
      id: typeof record.id === 'string' ? record.id : makeId(),
      durationMs: Math.round(record.durationMs),
      completedAt: Math.round(record.completedAt)
    };
  }

  // Keeps imported/older data safe enough to render and easy to upgrade later.
  function normalizeState(candidate) {
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.challenges)) return null;
    const ids = new Set();
    const challenges = candidate.challenges.reduce((items, raw) => {
      if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return items;
      const id = typeof raw.id === 'string' && raw.id && !ids.has(raw.id) ? raw.id : makeId();
      ids.add(id);
      const records = Array.isArray(raw.records) ? raw.records.map(normalizeRecord).filter(Boolean).sort((a, b) => a.completedAt - b.completedAt) : [];
      items.push({
        id,
        name: raw.name.trim().slice(0, 80),
        emoji: typeof raw.emoji === 'string' ? raw.emoji.trim().slice(0, 12) : '',
        standard: typeof raw.standard === 'string' ? raw.standard.trim().slice(0, 280) : '',
        createdAt: isFiniteTimestamp(raw.createdAt) ? raw.createdAt : Date.now(),
        updatedAt: isFiniteTimestamp(raw.updatedAt) ? raw.updatedAt : Date.now(),
        records
      });
      return items;
    }, []);
    const active = candidate.activeTimer;
    const activeTimer = active && typeof active.challengeId === 'string' && challenges.some((c) => c.id === active.challengeId) && isFiniteTimestamp(active.startedAt)
      ? { challengeId: active.challengeId, startedAt: active.startedAt }
      : null;
    return { version: DATA_VERSION, challenges, activeTimer };
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return freshState();
      return normalizeState(JSON.parse(saved)) || freshState();
    } catch (error) {
      console.warn('Could not read PB data:', error);
      return freshState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getChallenge(id) {
    return state.challenges.find((challenge) => challenge.id === id) || null;
  }

  function lastRecord(challenge) {
    return challenge.records.length ? challenge.records[challenge.records.length - 1] : null;
  }

  function pbRecord(challenge) {
    return challenge.records.reduce((best, record) => (!best || record.durationMs < best.durationMs ? record : best), null);
  }

  function formatTime(milliseconds, withTenths) {
    const totalTenths = Math.max(0, Math.floor(milliseconds / 100));
    const tenths = totalTenths % 10;
    const totalSeconds = Math.floor(totalTenths / 10);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    const base = hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return withTenths ? `${base}.${tenths}` : base;
  }

  function formatDifference(milliseconds) {
    const totalTenths = Math.max(0, Math.round(milliseconds / 100));
    const seconds = Math.floor(totalTenths / 10);
    const tenths = totalTenths % 10;
    if (seconds < 60) return tenths ? `${seconds}.${tenths} 秒` : `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const daysAgo = Math.round((startToday - startDate) / 86400000);
    if (daysAgo === 0) return '今天';
    if (daysAgo === 1) return '昨天';
    return date.getFullYear() === today.getFullYear()
      ? `${date.getMonth() + 1}月${date.getDate()}日`
      : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function setText(node, text) { node.textContent = text; }

  function showHome() {
    stopTicking();
    currentChallengeId = null;
    el.timerView.classList.add('is-hidden');
    el.homeView.classList.remove('is-hidden');
    renderHome();
  }

  function showTimer(id) {
    const challenge = getChallenge(id);
    if (!challenge) return showHome();
    currentChallengeId = id;
    el.homeView.classList.add('is-hidden');
    el.timerView.classList.remove('is-hidden');
    renderTimer();
    if (state.activeTimer && state.activeTimer.challengeId === id) startTicking();
    else stopTicking();
  }

  function renderHome() {
    el.challengeList.replaceChildren();
    if (!state.challenges.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const copy = document.createElement('p');
      copy.textContent = '把一件重复却总不想开始的事，变成和自己的下一场比赛。';
      empty.append(copy);
      el.challengeList.append(empty);
      return;
    }
    state.challenges.forEach((challenge) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'challenge-card';
      card.setAttribute('aria-label', `打开挑战：${challenge.name}`);
      card.addEventListener('click', () => showTimer(challenge.id));

      const emoji = document.createElement('span');
      emoji.className = 'card-emoji';
      emoji.textContent = challenge.emoji || '⏱️';
      const details = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = challenge.name;
      const scores = document.createElement('div');
      scores.className = 'card-scores';
      const pb = pbRecord(challenge);
      const last = lastRecord(challenge);
      const pbText = document.createElement('span');
      pbText.innerHTML = '🏆 PB ';
      const pbValue = document.createElement('b');
      pbValue.textContent = pb ? formatTime(pb.durationMs, false) : '—';
      pbText.append(pbValue);
      const lastText = document.createElement('span');
      lastText.innerHTML = '⚡ 上次 ';
      const lastValue = document.createElement('b');
      lastValue.textContent = last ? formatTime(last.durationMs, false) : '—';
      lastText.append(lastValue);
      scores.append(pbText, lastText);
      details.append(name, scores);
      const arrow = document.createElement('span');
      arrow.className = 'card-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = state.activeTimer && state.activeTimer.challengeId === challenge.id ? '●' : '›';
      card.append(emoji, details, arrow);
      el.challengeList.append(card);
    });
  }

  function renderTimer() {
    const challenge = getChallenge(currentChallengeId);
    if (!challenge) return;
    const isRunning = Boolean(state.activeTimer && state.activeTimer.challengeId === challenge.id);
    const pb = pbRecord(challenge);
    const last = lastRecord(challenge);
    setText(el.timerEmoji, challenge.emoji || '⏱️');
    setText(el.timerTitle, challenge.name);
    setText(el.pbTime, pb ? formatTime(pb.durationMs, false) : '—');
    setText(el.lastTime, last ? formatTime(last.durationMs, false) : '—');
    setText(el.standardText, challenge.standard);
    el.standardBlock.classList.toggle('is-hidden', !challenge.standard);
    setText(el.timerStatus, isRunning ? '挑战进行中' : '准备好就开始');
    el.timerStatus.classList.toggle('is-running', isRunning);
    setText(el.timerActionButton, isRunning ? '🏁 完成挑战' : '开始挑战');
    el.timerActionButton.classList.toggle('is-finishing', isRunning);
    setText(el.timerHint, isRunning ? '确认已达到你的完成标准，再记录本次成绩。' : '用真实完成时间，和过去的自己公平比赛。');
    updateClock();
    renderHistory(challenge);
  }

  function renderHistory(challenge) {
    el.historyList.replaceChildren();
    const records = challenge.records.slice(-HISTORY_LIMIT).reverse();
    if (!records.length) {
      const noHistory = document.createElement('li');
      noHistory.className = 'history-empty';
      noHistory.textContent = '第一场挑战，正在等你。';
      el.historyList.append(noHistory);
      return;
    }
    const currentPb = pbRecord(challenge);
    records.forEach((record) => {
      const item = document.createElement('li');
      const date = document.createElement('time');
      date.dateTime = new Date(record.completedAt).toISOString();
      date.textContent = formatDate(record.completedAt);
      const time = document.createElement('strong');
      time.textContent = formatTime(record.durationMs, false);
      const badge = document.createElement('span');
      badge.className = 'record-badge';
      badge.textContent = currentPb && record.id === currentPb.id ? '🏆 PB' : '';
      item.append(date, time, badge);
      el.historyList.append(item);
    });
  }

  function elapsedMs() {
    return state.activeTimer ? Math.max(0, Date.now() - state.activeTimer.startedAt) : 0;
  }

  function updateClock() {
    const runningHere = state.activeTimer && state.activeTimer.challengeId === currentChallengeId;
    setText(el.timerDisplay, runningHere ? formatTime(elapsedMs(), true) : '00:00.0');
  }

  function startTicking() {
    stopTicking();
    updateClock();
    tickHandle = window.setInterval(updateClock, 100);
  }

  function stopTicking() {
    if (tickHandle !== null) window.clearInterval(tickHandle);
    tickHandle = null;
  }

  function toggleTimer() {
    const challenge = getChallenge(currentChallengeId);
    if (!challenge) return;
    if (state.activeTimer) {
      if (state.activeTimer.challengeId === challenge.id) finishTimer(challenge);
      else showTimer(state.activeTimer.challengeId);
      return;
    }
    state.activeTimer = { challengeId: challenge.id, startedAt: Date.now() };
    saveState();
    renderTimer();
    startTicking();
  }

  function finishTimer(challenge) {
    const durationMs = elapsedMs();
    // A real elapsed timestamp keeps accuracy intact across background tabs and refreshes.
    const previousLast = lastRecord(challenge);
    const previousPb = pbRecord(challenge);
    const record = { id: makeId(), durationMs, completedAt: Date.now() };
    challenge.records.push(record);
    challenge.updatedAt = Date.now();
    state.activeTimer = null;
    saveState();
    stopTicking();
    renderTimer();
    openResult(record, previousLast, previousPb);
  }

  function openModal(content, onClose) {
    closeModal();
    modalCloseHandler = onClose || null;
    el.modalRoot.replaceChildren(content);
    el.modalRoot.classList.remove('is-hidden');
    const firstInput = content.querySelector('input, textarea, button');
    if (firstInput) window.setTimeout(() => firstInput.focus(), 0);
  }

  function closeModal() {
    if (el.modalRoot.classList.contains('is-hidden')) return;
    el.modalRoot.classList.add('is-hidden');
    el.modalRoot.replaceChildren();
    const handler = modalCloseHandler;
    modalCloseHandler = null;
    if (handler) handler();
  }

  function makeButton(text, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
  }

  function openChallengeForm(challenge) {
    const isEditing = Boolean(challenge);
    const modal = document.createElement('section');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2');
    heading.textContent = isEditing ? '编辑挑战' : '创建新挑战';
    const intro = document.createElement('p');
    intro.className = 'modal-intro';
    intro.textContent = '越清楚的完成标准，越能让每一次成绩可比较。';
    const form = document.createElement('form');
    form.noValidate = true;
    const nameInput = formField(form, '挑战名称', 'name', '例如：擦地', challenge ? challenge.name : '', true);
    const emojiInput = formField(form, 'Emoji / 图标', 'emoji', '例如：🧹', challenge ? challenge.emoji : '', false);
    emojiInput.maxLength = 12;
    const standardInput = formField(form, '完成标准', 'standard', '例如：客厅 + 两个卧室全部擦完', challenge ? challenge.standard : '', false, true);
    const error = document.createElement('p');
    error.className = 'form-error';
    error.setAttribute('role', 'alert');
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = makeButton('取消', 'button-secondary');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'button-primary';
    submit.textContent = isEditing ? '保存修改' : '创建挑战';
    cancel.addEventListener('click', closeModal);
    actions.append(cancel, submit);
    form.append(error, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        error.textContent = '给这场比赛起个名字吧。';
        nameInput.focus();
        return;
      }
      if (isEditing) {
        challenge.name = name.slice(0, 80);
        challenge.emoji = emojiInput.value.trim().slice(0, 12);
        challenge.standard = standardInput.value.trim().slice(0, 280);
        challenge.updatedAt = Date.now();
      } else {
        const newChallenge = {
          id: makeId(), name: name.slice(0, 80), emoji: emojiInput.value.trim().slice(0, 12),
          standard: standardInput.value.trim().slice(0, 280), createdAt: Date.now(), updatedAt: Date.now(), records: []
        };
        state.challenges.unshift(newChallenge);
        currentChallengeId = newChallenge.id;
      }
      saveState();
      closeModal();
      showTimer(currentChallengeId);
    });
    modal.append(heading, intro, form);
    openModal(modal);
  }

  function formField(form, labelText, fieldName, placeholder, value, required, multiline) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const label = document.createElement('label');
    label.htmlFor = `field-${fieldName}`;
    label.textContent = labelText;
    if (!required) {
      const optional = document.createElement('span');
      optional.className = 'optional';
      optional.textContent = '（可选）';
      label.append(optional);
    }
    const control = multiline ? document.createElement('textarea') : document.createElement('input');
    control.id = `field-${fieldName}`;
    control.name = fieldName;
    control.placeholder = placeholder;
    control.value = value || '';
    if (!multiline) control.type = 'text';
    if (required) control.required = true;
    wrapper.append(label, control);
    form.append(wrapper);
    return control;
  }

  function openDeleteConfirm(challenge) {
    const modal = document.createElement('section');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2');
    heading.textContent = '删除这个挑战？';
    const copy = document.createElement('p');
    copy.className = 'modal-intro';
    copy.textContent = `“${challenge.name}”的 ${challenge.records.length} 条历史成绩将一并删除，且无法恢复。`;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = makeButton('保留挑战', 'button-secondary');
    const remove = makeButton('确认删除', 'button-danger');
    cancel.addEventListener('click', closeModal);
    remove.addEventListener('click', () => {
      state.challenges = state.challenges.filter((item) => item.id !== challenge.id);
      if (state.activeTimer && state.activeTimer.challengeId === challenge.id) state.activeTimer = null;
      saveState();
      closeModal();
      showHome();
    });
    actions.append(cancel, remove);
    modal.append(heading, copy, actions);
    openModal(modal);
  }

  function openEditMenu() {
    const challenge = getChallenge(currentChallengeId);
    if (!challenge) return;
    const modal = document.createElement('section');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2');
    heading.textContent = challenge.name;
    const intro = document.createElement('p');
    intro.className = 'modal-intro';
    intro.textContent = '名称和完成标准可随时调整。';
    const edit = makeButton('编辑挑战', 'button-primary');
    const remove = makeButton('删除挑战', 'button-danger');
    const cancel = makeButton('取消', 'button-secondary');
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    edit.addEventListener('click', () => openChallengeForm(challenge));
    remove.addEventListener('click', () => openDeleteConfirm(challenge));
    cancel.addEventListener('click', closeModal);
    actions.append(cancel, remove, edit);
    modal.append(heading, intro, actions);
    openModal(modal);
  }

  function openResult(record, previousLast, previousPb) {
    const isNewPb = !previousPb || record.durationMs < previousPb.durationMs;
    const beatLast = previousLast && record.durationMs < previousLast.durationMs;
    const modal = document.createElement('section');
    modal.className = `modal result-modal${isNewPb ? ' new-pb' : ''}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const symbol = document.createElement('span');
    symbol.className = 'result-symbol';
    symbol.textContent = isNewPb ? '🏆' : beatLast ? '⚡' : '✓';
    const heading = document.createElement('h2');
    heading.textContent = isNewPb ? 'NEW PB！' : beatLast ? '击败上一次的自己！' : '本次挑战完成';
    const time = document.createElement('div');
    time.className = 'result-time';
    time.textContent = formatTime(record.durationMs, true);
    const details = document.createElement('div');
    details.className = 'result-details';
    if (isNewPb) {
      const recordCopy = document.createElement('p');
      recordCopy.className = 'record-copy';
      recordCopy.textContent = `新的个人纪录：${formatTime(record.durationMs, false)}`;
      details.append(recordCopy);
      if (previousPb) {
        const improved = document.createElement('p');
        improved.className = 'positive';
        improved.textContent = `比原纪录快 ${formatDifference(previousPb.durationMs - record.durationMs)}`;
        details.append(improved);
      } else {
        const first = document.createElement('p');
        first.textContent = '第一条个人纪录已经诞生。';
        details.append(first);
      }
    } else {
      if (beatLast) {
        const improved = document.createElement('p');
        improved.className = 'positive';
        improved.textContent = `比上次快 ${formatDifference(previousLast.durationMs - record.durationMs)}`;
        details.append(improved);
      } else if (previousLast) {
        const lastGap = document.createElement('p');
        lastGap.textContent = `比上次慢 ${formatDifference(record.durationMs - previousLast.durationMs)}`;
        details.append(lastGap);
      }
      const gap = document.createElement('p');
      gap.textContent = `距离 PB 还差 ${formatDifference(record.durationMs - previousPb.durationMs)}`;
      details.append(gap);
    }
    const done = makeButton('继续', 'button-primary');
    done.addEventListener('click', closeModal);
    modal.append(symbol, heading, time, details, done);
    openModal(modal);
  }

  function openSettings() {
    const modal = document.createElement('section');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2');
    heading.textContent = '设置与数据';
    const intro = document.createElement('p');
    intro.className = 'modal-intro';
    intro.textContent = '🔒 数据仅保存在你的设备。';
    const list = document.createElement('div');
    list.className = 'settings-list';
    const exportRow = settingsRow('导出数据', '保存一份 JSON 备份到本地。', '导出');
    exportRow.button.addEventListener('click', exportData);
    const importRow = settingsRow('导入数据', '用已导出的 JSON 恢复，当前数据会被替换。', '导入');
    importRow.button.addEventListener('click', () => el.importInput.click());
    list.append(exportRow.row, importRow.row);
    const note = document.createElement('p');
    note.className = 'privacy-note';
    note.textContent = 'PB 不需要账号，也没有服务器。你的挑战和成绩仅保存在当前浏览器中，我们无法查看你的记录。清除浏览器数据可能会移除这些记录，请在重要时导出备份。';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const close = makeButton('完成', 'button-primary');
    close.addEventListener('click', closeModal);
    actions.append(close);
    modal.append(heading, intro, list, note, actions);
    openModal(modal);
  }

  function settingsRow(title, description, action) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const copy = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = title;
    const info = document.createElement('p');
    info.textContent = description;
    copy.append(heading, info);
    const button = makeButton(action, 'button-secondary');
    row.append(copy, button);
    return { row, button };
  }

  function exportData() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `pb-backup-${stamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function handleImport(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let imported;
      try { imported = normalizeState(JSON.parse(String(reader.result))); } catch (_) { imported = null; }
      if (!imported) return showImportError('无法读取这个备份文件。请选择从 PB 导出的 JSON 文件。');
      openImportConfirm(imported);
    };
    reader.onerror = () => showImportError('读取备份文件时出错，请重试。');
    reader.readAsText(file);
  }

  function showImportError(message) {
    const modal = document.createElement('section');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    const heading = document.createElement('h2');
    heading.textContent = '导入未完成';
    const copy = document.createElement('p');
    copy.className = 'modal-intro';
    copy.textContent = message;
    const done = makeButton('知道了', 'button-primary');
    done.addEventListener('click', closeModal);
    modal.append(heading, copy, done);
    openModal(modal);
  }

  function openImportConfirm(imported) {
    const modal = document.createElement('section');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h2');
    heading.textContent = '替换当前数据？';
    const copy = document.createElement('p');
    copy.className = 'modal-intro';
    copy.textContent = `将导入 ${imported.challenges.length} 个挑战，并替换此浏览器中现有的全部 PB 数据。建议先导出现有数据。`;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = makeButton('取消', 'button-secondary');
    const confirm = makeButton('确认导入', 'button-primary');
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', () => {
      state = imported;
      saveState();
      closeModal();
      if (state.activeTimer) showTimer(state.activeTimer.challengeId);
      else showHome();
    });
    actions.append(cancel, confirm);
    modal.append(heading, copy, actions);
    openModal(modal);
  }

  function bindEvents() {
    el.homeButton.addEventListener('click', showHome);
    el.settingsButton.addEventListener('click', openSettings);
    el.createChallengeButton.addEventListener('click', () => openChallengeForm(null));
    el.privacyButton.addEventListener('click', openSettings);
    el.backButton.addEventListener('click', showHome);
    el.editChallengeButton.addEventListener('click', openEditMenu);
    el.timerActionButton.addEventListener('click', toggleTimer);
    el.importInput.addEventListener('change', handleImport);
    el.modalRoot.addEventListener('click', (event) => { if (event.target === el.modalRoot) closeModal(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !el.modalRoot.classList.contains('is-hidden')) closeModal(); });
  }

  bindEvents();
  if (state.activeTimer) showTimer(state.activeTimer.challengeId);
  else showHome();
})();
