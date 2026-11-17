const lecturers = ['Bu Rina', 'Pak Andi', 'Bu Sari', 'Pak Bima'];
const categories = { teach: 'Mengajar', duty: 'Piket', trip: 'Tugas luar' };
const weekly = [
  { day: 1, type: 'teach', lecturer: 'Pak Bima', start: '08:00', end: '10:00', title: 'Pemrograman Dasar' },
  { day: 1, type: 'duty', lecturer: 'Bu Sari', start: '10:00', end: '13:00', title: 'Piket fakultas' },
  { day: 2, type: 'teach', lecturer: 'Bu Rina', start: '09:00', end: '10:30', title: 'Matematika Teknik' },
  { day: 2, type: 'duty', lecturer: 'Pak Andi', start: '11:00', end: '13:00', title: 'Piket fakultas' },
  { day: 3, type: 'teach', lecturer: 'Bu Sari', start: '08:00', end: '10:00', title: 'Mekanika Teknik' },
  { day: 3, type: 'duty', lecturer: 'Bu Rina', start: '13:00', end: '15:00', title: 'Piket fakultas' },
  { day: 4, type: 'teach', lecturer: 'Pak Andi', start: '09:00', end: '11:00', title: 'Sistem Digital' },
  { day: 4, type: 'teach', lecturer: 'Pak Bima', start: '13:00', end: '15:00', title: 'Praktikum Pemrograman' },
  { day: 5, type: 'duty', lecturer: 'Pak Bima', start: '09:00', end: '11:00', title: 'Piket fakultas' },
];

const wibDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', dateStyle: 'short' });
const todayKey = wibDate.format(new Date());
const today = new Date(`${todayKey}T12:00:00`);
const demoMonth = todayKey.slice(0, 7);
const trips = [
  { day: 10, lecturer: 'Bu Rina', start: '10:00', end: '12:00', title: 'Rapat mitra industri' },
  { day: 12, lecturer: 'Bu Sari', start: '09:00', end: '13:00', title: 'Kunjungan industri' },
  { day: 18, lecturer: 'Pak Bima', start: '08:30', end: '12:00', title: 'Seminar teknik' },
  { day: 24, lecturer: 'Pak Andi', start: '11:30', end: '14:00', title: 'Koordinasi laboratorium mitra' },
  { day: 26, lecturer: 'Bu Rina', start: '08:00', end: '11:00', title: 'Pendampingan kegiatan mahasiswa' },
].map(({ day, ...trip }) => ({ ...trip, type: 'trip', date: `${demoMonth}-${String(day).padStart(2, '0')}` }));

const monthFormat = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
const dayFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' });
const recapDateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' });
const byId = (id) => document.getElementById(id);
const requestedDate = new URLSearchParams(location.search).get('tanggal');
let selected = window.ftScheduleModel?.validDate(requestedDate) ? new Date(requestedDate + 'T12:00:00') : today;
let month = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
let savedData;
let loadedSnapshot;
let loadSequence = 0;

const lecturerKey = (event) => String(event.lecturerId ?? event.lecturer);
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function dateKey(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-');
}

function scheduleFor(date) {
  if (savedData) {
    return savedData.schedules.filter((event) => window.ftScheduleModel.appliesOn(event, dateKey(date)))
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  return [
    ...weekly.filter((event) => event.day === date.getDay()),
    ...trips.filter((event) => event.date === dateKey(date)),
  ].sort((a, b) => a.start.localeCompare(b.start));
}

function overlapping(events, proposal) {
  return events.filter((event) => event !== proposal && lecturerKey(event) === lecturerKey(proposal)
    && event.start < proposal.end && proposal.start < event.end);
}

function conflictLabel(event) {
  if (event.type === 'duty') return 'Perlu pengganti piket';
  if (event.type === 'teach') return 'Bentrok mengajar';
  return 'Bentrok tugas luar';
}

function overlapTime(event, proposal) {
  const start = event.start > proposal.start ? event.start : proposal.start;
  const end = event.end < proposal.end ? event.end : proposal.end;
  return `${start}–${end} WIB`;
}

function conflictsFor(event, events) {
  return event.type === 'trip' ? overlapping(events, event) : [];
}

function visibleEvents(events) {
  const lecturer = byId('lecturer-filter').value;
  return lecturer ? events.filter((event) => lecturerKey(event) === lecturer) : events;
}

const activityText = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const programHues = new Map([['mesin', 155], ['sipil', 30], ['ti', 270]]);
const programOrder = new Map([['ti', 0], ['mesin', 1], ['sipil', 2]]);
const detailOrder = { trip: 0, teach: 1, duty: 2 };
const classProgram = (event) => event.teachingProgram || event.program || '';

function compareAgenda([a], [b]) {
  const byCategory = detailOrder[a.type] - detailOrder[b.type];
  if (byCategory || a.type !== 'teach') return byCategory;
  const aProgram = activityText(classProgram(a));
  const bProgram = activityText(classProgram(b));
  return (programOrder.get(aProgram) ?? programOrder.size) - (programOrder.get(bProgram) ?? programOrder.size)
    || aProgram.localeCompare(bProgram, 'id');
}

function programTag(program) {
  const key = activityText(program);
  const hue = programHues.get(key) ?? [...key].reduce((value, character) =>
    (value * 31 + character.codePointAt(0)) % 360, 0);
  return `<span class="tag program-tag" style="--program-hue: ${hue}">Mengajar di Prodi ${escapeHtml(program)}</span>`;
}

function activityKey(event) {
  const title = activityText(event.title);
  if (event.type === 'trip') return JSON.stringify(['trip', event.date, title]);
  if (event.type === 'teach' && classProgram(event)) {
    return JSON.stringify(['teach', title, activityText(classProgram(event)), event.start, event.end]);
  }
  return event;
}

function tripTotals(schedule) {
  const assignments = schedule.filter(({ type }) => type === 'trip');
  return { activities: Map.groupBy(assignments, activityKey).size, assignments: assignments.length };
}

function renderTripRecap() {
  if (!byId('lecturer-recap').open) return;
  const now = Date.now();
  const currentDate = wibDate.format(now);
  const through = byId('recap-through');
  const endOfDay = Date.parse(through.value + 'T23:59:59.999+07:00');
  if (!Number.isFinite(endOfDay)) through.value = currentDate;
  const cutoff = through.value === currentDate ? now : endOfDay;
  const monthKey = dateKey(month).slice(0, 7);
  const directory = savedData?.directory ?? lecturers.map((name) => ({ name }));
  const assignments = (savedData?.schedules ?? trips).filter(({ type }) => type === 'trip');
  const byLecturer = Map.groupBy(assignments, lecturerKey);
  const rows = directory.map(({ id, name, program }) => {
    const activities = Map.groupBy(byLecturer.get(String(id ?? name)) ?? [], activityKey);
    let monthly = 0;
    let total = 0;
    let lastTripDate = '';
    for (const members of activities.values()) {
      const ended = members.every(({ date, end }) => Date.parse(date + 'T' + end + ':00+07:00') <= cutoff);
      if (ended) {
        const { date } = members[0];
        total++;
        if (date.startsWith(monthKey)) monthly++;
        if (date > lastTripDate) lastTripDate = date;
      }
    }
    return { name, program, monthly, total, lastTripDate };
  }).sort((a, b) => b.monthly - a.monthly || b.total - a.total || a.name.localeCompare(b.name, 'id'));

  byId('recap-month').textContent = monthFormat.format(month);
  byId('recap-total').textContent = through.value > currentDate
    ? 'Proyeksi hingga tanggal pilihan'
    : 'Total hingga tanggal pilihan';
  byId('recap-rows').innerHTML = rows.map(({ name, program, monthly, total, lastTripDate }) => `
    <tr>
      <th scope="row">${escapeHtml(name)}${program ? `<small>${escapeHtml(program)}</small>` : ''}</th>
      <td>${monthly}</td>
      <td>${total}${lastTripDate ? `<small>Terakhir ${recapDateFormat.format(new Date(lastTripDate))}</small>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="3">Belum ada dosen terdaftar.</td></tr>';
}

function renderTripMonths() {
  const events = visibleEvents(savedData?.schedules ?? trips).filter(({ type }) => type === 'trip');
  const months = Map.groupBy(events, ({ date }) => date.slice(0, 7));
  const options = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([key, entries]) => {
    const dates = entries.map(({ date }) => date).sort();
    const activities = Map.groupBy(entries, activityKey).size;
    return new Option(monthFormat.format(new Date(key + '-01T12:00:00')) + ' · ' + activities + ' tugas luar', dates[0]);
  });
  byId('trip-month').replaceChildren(new Option('Pilih bulan', ''), ...options);
  byId('trip-navigation').hidden = options.length === 0;
}

function renderMonth() {
  const year = month.getFullYear();
  const index = month.getMonth();
  const dayCount = new Date(year, index + 1, 0).getDate();
  const leading = (month.getDay() + 6) % 7;
  const counts = { teach: 0, duty: 0, trip: 0, conflict: 0 };
  const cells = Array(leading).fill('<div class="empty-day" aria-hidden="true"></div>');

  for (let day = 1; day <= dayCount; day += 1) {
    const date = new Date(year, index, day, 12);
    const key = dateKey(date);
    const schedule = scheduleFor(date);
    const { activities: tripsToday } = tripTotals(schedule);
    let classesToday = 0;
    for (const members of Map.groupBy(visibleEvents(schedule), activityKey).values()) {
      const [first] = members;
      counts[first.type] += 1;
      if (first.type === 'teach') classesToday += 1;
      if (members.some((event) => conflictsFor(event, schedule).length > 0)) counts.conflict += 1;
    }
    const tripChip = tripsToday ? `<span class="chip trip">${tripsToday} tugas luar</span>` : '';
    const teachChip = classesToday ? `<span class="chip teach">${classesToday} mengajar</span>` : '';
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    cells.push(`<button class="day${weekend ? ' weekend' : ''}" type="button" data-day="${day}"
      aria-label="${dayFormat.format(date)}, ${tripsToday} kegiatan tugas luar seluruh dosen, ${classesToday} jadwal mengajar"
      aria-pressed="${key === dateKey(selected)}"${key === todayKey ? ' aria-current="date"' : ''}>
      <span class="day-number">${day}</span>${tripChip}${teachChip}
    </button>`);
  }

  while (cells.length % 7) cells.push('<div class="empty-day" aria-hidden="true"></div>');
  byId('month-title').textContent = monthFormat.format(month);
  byId('days').innerHTML = cells.join('');
  const labels = { ...categories, conflict: 'Tugas luar bentrok' };
  byId('stats').innerHTML = Object.entries(counts).map(([type, count]) => `
    <div class="stat ${type}"><span class="stat-marker" aria-hidden="true"></span>
      <div><strong>${count}</strong><span>${labels[type]}</span></div>
    </div>`).join('');
}

function renderDay() {
  const schedule = scheduleFor(selected);
  const totals = tripTotals(schedule);
  const activities = [...Map.groupBy(visibleEvents(schedule), activityKey).values()]
    .sort(compareAgenda);
  byId('day-title').textContent = dayFormat.format(selected);
  byId('day-count').textContent = `${activities.length} jadwal tercatat`;
  byId('day-trip-count').textContent = `${totals.activities} kegiatan · ${totals.assignments} penugasan`;
  byId('agenda').innerHTML = activities.map((members) => {
    const [first] = members;
    const sharedTime = members.every(({ start, end }) => start === first.start && end === first.end);
    const sharedSemester = first.type === 'teach' && first.semester
      && members.every(({ semester }) => semester === first.semester);
    const metadata = [
      sharedSemester ? 'Semester ' + first.semester : '',
      sharedTime ? `${first.start}–${first.end} WIB` : 'Jam berbeda per dosen',
      new Set(members.map(lecturerKey)).size + ' dosen',
    ].filter(Boolean).join(' · ');
    let hasConflict = false;
    const people = members.map((event) => {
      const hours = sharedTime ? '' : ` · ${event.start}–${event.end} WIB`;
      const semester = event.type === 'teach' && event.semester && !sharedSemester ? ` · Semester ${event.semester}` : '';
      const homeProgram = event.type === 'teach' && event.program ? ` · Prodi asal ${escapeHtml(event.program)}` : '';
      const conflicts = conflictsFor(event, schedule);
      if (conflicts.length) hasConflict = true;
      const warnings = conflicts.map((conflict) => `<p class="warning">${conflictLabel(conflict)} · ${overlapTime(conflict, event)}</p>`).join('');
      return `<li><p>${escapeHtml(event.lecturer)}${homeProgram}${semester}${hours}</p>${warnings}</li>`;
    }).join('');
    const conflictTag = hasConflict ? '<span class="tag conflict">Bentrok</span>' : '';
    const programLabel = first.type === 'teach' && classProgram(first) ? programTag(classProgram(first)) : '';
    return `<details class="agenda-item ${first.type}" name="daily-agenda">
      <summary class="agenda-summary">
        <span class="agenda-overview">
          <span class="agenda-tags"><span class="tag">${categories[first.type]}</span>${programLabel}${conflictTag}</span>
          <strong>${escapeHtml(first.title)}</strong>
          <span class="agenda-meta">${escapeHtml(metadata)}</span>
        </span>
      </summary>
      <div class="agenda-detail"><ul class="agenda-members">${people}</ul></div>
    </details>`;
  }).join('') || '<p class="muted empty-agenda">Belum ada jadwal tercatat pada tanggal ini.</p>';
}

function render() {
  renderTripMonths();
  renderTripRecap();
  renderMonth();
  renderDay();
}

function moveMonth(offset) {
  month = new Date(month.getFullYear(), month.getMonth() + offset, 1, 12);
  selected = month;
  render();
}

const options = lecturers.map((name) => `<option>${name}</option>`).join('');
byId('lecturer-filter').innerHTML = '<option value="">Semua dosen</option>' + options;
byId('lecturer-filter').addEventListener('change', render);
byId('lecturer-recap').addEventListener('toggle', renderTripRecap);
byId('recap-through').addEventListener('change', renderTripRecap);
byId('previous').addEventListener('click', () => moveMonth(-1));
byId('next').addEventListener('click', () => moveMonth(1));
byId('today').addEventListener('click', () => {
  month = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  selected = today;
  render();
});
byId('trip-month').addEventListener('change', (event) => {
  if (!event.target.value) return;
  selected = new Date(event.target.value + 'T12:00:00');
  month = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
  render();
  event.target.value = dateKey(selected);
});
byId('days').addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (!button) return;
  const previous = byId('days').querySelector('[aria-pressed="true"]');
  previous?.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-pressed', 'true');
  selected = new Date(month.getFullYear(), month.getMonth(), Number(button.dataset.day), 12);
  renderDay();
});
async function loadDatabaseSchedule() {
  if (location.protocol === 'file:') return;
  const sequence = ++loadSequence;
  try {
    const response = await fetch('/api/schedule');
    if (!response.ok) return;
    const snapshot = await response.text();
    if (sequence !== loadSequence || snapshot === loadedSnapshot) return;
    const { lecturers: directory, schedules, calendarOnly } = JSON.parse(snapshot);
    const lecturersById = new Map(directory.map((lecturer) => [lecturer.id, lecturer]));
    const filter = byId('lecturer-filter').value;
    savedData = { directory, schedules: schedules.map((event) => {
      const { name, program } = lecturersById.get(event.lecturerId);
      return { ...event, lecturer: name, program };
    }) };
    const lecturerOptions = () => directory.map(({ id, name, program }) => new Option(name + ' · ' + program, id));
    byId('lecturer-filter').replaceChildren(new Option('Semua dosen', ''), ...lecturerOptions());
    if (lecturersById.has(Number(filter))) byId('lecturer-filter').value = filter;
    byId('calendar-demo').hidden = true;
    byId('calendar-admin').hidden = Boolean(calendarOnly);
    render();
    loadedSnapshot = snapshot;
  } catch {
    // The static demonstration remains usable without the local server.
  }
}

render();
loadDatabaseSchedule();
if (location.protocol !== 'file:') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      renderTripRecap();
      loadDatabaseSchedule();
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) loadDatabaseSchedule();
  });
  if (typeof BroadcastChannel === 'function') {
    const updates = new BroadcastChannel('ft-schedule');
    updates.addEventListener('message', loadDatabaseSchedule);
  }
}
