(() => {
  const root = document.getElementById('ft-admin');
  const get = (id) => root.querySelector('#' + id);
  const model = window.ftScheduleModel;
  const store = window.ftAdminStore;
  const form = get('admin-schedule');
  const scheduleLecturers = get('admin-schedule-lecturers');
  const addScheduleLecturer = get('admin-add-schedule-lecturer');
  const lecturerSelects = () => [...scheduleLecturers.querySelectorAll('select')];
  const directory = get('admin-lecturer');
  const importForm = get('admin-import');
  const fieldsets = [importForm, form, directory].map((element) => element.querySelector('fieldset'));
  const updates = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ft-schedule') : null;
  const field = (name) => form.elements.namedItem(name);
  const kindButtons = [...root.querySelectorAll('[data-kind]')];
  const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' });
  const weekdayFormat = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'UTC' });
  const toDate = (value) => new Date(value + 'T00:00:00Z');
  const displayDate = (value) => dateFormat.format(toDate(value));
  const searchText = (value) => value.normalize('NFKC').toLocaleLowerCase('id');
  const recordFilters = ['admin-search', 'admin-search-date', 'admin-filter'].map(get);
  const tripSlot = ({ title, date, start, end }) => JSON.stringify([title, date, start, end]);
  const titleLabels = { teach: 'Mata kuliah', trip: 'Nama penugasan', duty: 'Nama piket' };
  const placeholders = { teach: 'Contoh: Matematika Teknik', trip: 'Contoh: Kunjungan industri', duty: 'Contoh: Piket fakultas' };
  let kind = 'teach';
  let limit = 6;
  let data = { lecturers: [], schedules: [] };

  function status(id, text, error = false) {
    const output = get(id);
    output.textContent = text;
    output.classList.toggle('admin-error', error);
  }

  function sortedLecturers() {
    return [...data.lecturers].sort((a, b) => a.name.localeCompare(b.name, 'id') || a.program.localeCompare(b.program, 'id'));
  }

  function fillLecturerSelect(select, lecturers, selected = select.value) {
    select.replaceChildren(
      new Option('Pilih dosen', ''),
      ...lecturers.map(({ id, name, program }) => new Option(name + ' · ' + program, id)),
    );
    select.value = selected;
  }

  function updateLecturerOptions() {
    const selects = lecturerSelects();
    const selected = new Set(selects.map((select) => select.value).filter(Boolean));
    for (const select of selects) {
      for (const option of select.options) {
        option.disabled = option.value !== select.value && selected.has(option.value);
      }
    }
    addScheduleLecturer.disabled = selects.length >= data.lecturers.length;
  }

  function renderLecturers(selected) {
    const sorted = sortedLecturers();
    lecturerSelects().forEach((select, index) => fillLecturerSelect(select, sorted, index === 0 ? selected : undefined));
    updateLecturerOptions();
    const programs = [...new Set(sorted.map(({ program }) => program))].sort((a, b) => a.localeCompare(b, 'id'));
    get('admin-programs').replaceChildren(...programs.map((program) => new Option(program)));
    get('admin-lecturer-count').textContent = sorted.length + ' terdaftar';
    get('admin-directory-list').replaceChildren(...sorted.map(({ name, program }) => listElement('li', name + ' · ' + program)));
  }

  function listElement(tag, text, className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  function tripConflicts(entry) {
    return model.conflictsWith(data.schedules.filter((row) => row.id !== entry.id), entry);
  }

  function dateEditor(entry) {
    const editor = get('admin-date-editor').content.firstElementChild.cloneNode(true);
    const editorForm = editor.querySelector('form');
    const input = editorForm.elements.namedItem('date');
    const save = editorForm.querySelector('[type="submit"]');
    const cancel = editorForm.querySelector('[type="button"]');
    const warning = editorForm.querySelector('.admin-conflicts');
    const feedback = editorForm.querySelector('.admin-status');
    const summary = editor.querySelector('summary');
    summary.dataset.tripId = entry.id;
    summary.setAttribute('aria-label', 'Ubah tanggal ' + entry.title);
    input.value = entry.date;
    input.addEventListener('input', () => {
      feedback.textContent = '';
      const conflicts = model.validDate(input.value) ? tripConflicts({ ...entry, date: input.value }) : [];
      warning.hidden = conflicts.length === 0;
      warning.textContent = conflicts.length
        ? 'Bentrok dengan ' + conflicts.map((item) => item.title + ' (' + item.start + '–' + item.end + ' WIB)').join(', ') + '.'
        : '';
    });
    cancel.addEventListener('click', () => {
      input.value = entry.date;
      warning.hidden = true;
      feedback.textContent = '';
      editor.open = false;
      summary.focus();
    });
    editorForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (fieldsets.some((fields) => fields.disabled)) {
        feedback.textContent = 'Tunggu penyimpanan yang sedang berjalan.';
        return;
      }
      const date = input.value;
      const controls = [...fieldsets, input, save, cancel];
      controls.forEach((control) => { control.disabled = true; });
      feedback.textContent = '';
      try {
        const updated = await store.editTripDate(entry.id, date, entry.date);
        data.schedules = data.schedules.map((row) => row.id === updated.id ? updated : row);
        updates?.postMessage('updated');
        const restoreFocus = editor.contains(document.activeElement) || document.activeElement === document.body;
        renderList();
        status('admin-edit-status', updated.title + ' tersimpan pada ' + displayDate(updated.date) + '.');
        if (restoreFocus) root.querySelector('[data-trip-id="' + updated.id + '"]')?.focus();
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        controls.forEach((control) => { control.disabled = false; });
        showConflicts();
      }
    });
    return editor;
  }

  function participantsEditor(entry, group) {
    const editor = get('admin-participants-editor').content.firstElementChild.cloneNode(true);
    const editorForm = editor.querySelector('form');
    const summary = editor.querySelector('summary');
    const choices = editorForm.querySelector('.admin-participant-list');
    const save = editorForm.querySelector('[type="submit"]');
    const cancel = editorForm.querySelector('[type="button"]');
    const warning = editorForm.querySelector('.admin-conflicts');
    const feedback = editorForm.querySelector('.admin-status');
    const previousLecturerIds = group.map(({ lecturerId }) => lecturerId);
    const memberIds = new Set(group.map(({ id }) => id));
    const selectedIds = () => new FormData(editorForm).getAll('lecturerId').map(Number);
    const slot = tripSlot(entry);
    summary.dataset.participantsSlot = slot;
    summary.setAttribute('aria-label', 'Ubah peserta ' + entry.title);

    editor.addEventListener('toggle', () => {
      if (!editor.open || choices.childElementCount) return;
      choices.replaceChildren(...sortedLecturers().map(({ id, name, program }) => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'lecturerId';
        checkbox.value = id;
        checkbox.defaultChecked = previousLecturerIds.includes(id);
        label.append(checkbox, name + ' · ' + program);
        return label;
      }));
    });
    editorForm.addEventListener('change', () => {
      feedback.textContent = '';
      const otherSchedules = data.schedules.filter(({ id }) => !memberIds.has(id));
      const conflicts = selectedIds().flatMap((lecturerId) => model.conflictsWith(otherSchedules, { ...entry, lecturerId }));
      const names = new Map(data.lecturers.map(({ id, name }) => [id, name]));
      warning.hidden = conflicts.length === 0;
      warning.textContent = conflicts.length
        ? 'Bentrok jadwal: ' + conflicts.map(({ lecturerId, title }) => names.get(lecturerId) + ' · ' + title).join(', ') + '.'
        : '';
    });
    cancel.addEventListener('click', () => {
      choices.replaceChildren();
      warning.hidden = true;
      feedback.textContent = '';
      editor.open = false;
      summary.focus();
    });
    editorForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (fieldsets.some((fields) => fields.disabled)) {
        feedback.textContent = 'Tunggu penyimpanan yang sedang berjalan.';
        return;
      }
      const lecturerIds = selectedIds();
      if (!lecturerIds.length) {
        feedback.textContent = 'Pilih minimal satu dosen.';
        return;
      }
      const controls = [...fieldsets, editorForm.querySelector('fieldset'), save, cancel];
      controls.forEach((control) => { control.disabled = true; });
      feedback.textContent = '';
      try {
        const { id, title, date, start, end } = entry;
        const updated = await store.editTripParticipants(id, { title, date, start, end, lecturerIds, previousLecturerIds });
        data.schedules = [...data.schedules.filter(({ id }) => !memberIds.has(id)), ...updated]
          .sort((a, b) => b.id - a.id);
        updates?.postMessage('updated');
        const restoreFocus = editor.contains(document.activeElement) || document.activeElement === document.body;
        renderList();
        status('admin-edit-status', 'Peserta ' + entry.title + ' berhasil diperbarui.');
        if (restoreFocus) get('admin-records').querySelector('[data-participants-slot=' + CSS.escape(slot) + ']')?.focus();
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        controls.forEach((control) => { control.disabled = false; });
        showConflicts();
      }
    });
    return editor;
  }

  function resetRecordFilters() {
    for (const input of recordFilters) input.value = '';
    limit = 6;
    renderList();
  }

  function renderList() {
    const [search, dateFilter, categoryFilter] = recordFilters;
    const terms = searchText(search.value).match(/\S+/g) ?? [];
    const selectedDate = dateFilter.value;
    const category = categoryFilter.value;
    const lecturers = new Map(data.lecturers.map((lecturer) => [lecturer.id, lecturer]));
    const schedules = data.schedules.filter((entry) => {
      if (category && category !== entry.type) return false;
      if (selectedDate && !model.appliesOn(entry, selectedDate)) return false;
      if (!terms.length) return true;
      const weekday = weekdayFormat.format(toDate(entry.date));
      const text = searchText([lecturers.get(entry.lecturerId)?.name, weekday, entry.title].join(' '));
      return terms.every((term) => text.includes(term));
    });
    const tripGroups = Map.groupBy(data.schedules.filter(({ type }) => type === 'trip'), tripSlot);
    const shownTripSlots = new Set();
    const items = schedules.slice(0, limit).map((entry) => {
      const item = document.createElement('li');
      const type = listElement('span', model.labels[entry.type], 'admin-type');
      type.dataset.type = entry.type;
      const weekday = weekdayFormat.format(toDate(entry.date));
      const date = entry.through && !selectedDate
        ? 'Setiap ' + weekday + ' · ' + displayDate(entry.date) + '–' + displayDate(entry.through)
        : weekday + ', ' + displayDate(selectedDate || entry.date);
      const semester = entry.type === 'teach' && entry.semester ? ' · Semester ' + entry.semester : '';
      const { name, program } = lecturers.get(entry.lecturerId) ?? {};
      const teachingProgram = entry.type === 'teach' ? (entry.teachingProgram || program) : '';
      const destination = teachingProgram ? ' · Mengajar di Prodi ' + teachingProgram : '';
      const lecturerLabel = (name ?? '') + (teachingProgram && program ? ' · Prodi asal ' + program : '');
      const info = listElement('small', date + ' · ' + entry.start + '–' + entry.end + ' WIB' + semester + destination);
      item.append(type, listElement('span', lecturerLabel), listElement('strong', entry.title), info);
      if (entry.type === 'trip') {
        if (tripConflicts(entry).length) item.append(listElement('small', 'Ada bentrok jadwal', 'admin-error'));
        item.append(dateEditor(entry));
        const slot = tripSlot(entry);
        if (!shownTripSlots.has(slot)) {
          item.append(participantsEditor(entry, tripGroups.get(slot)));
          shownTripSlots.add(slot);
        }
      }
      return item;
    });
    const emptyMessage = terms.length || selectedDate || category
      ? 'Tidak ada jadwal yang cocok.' : 'Belum ada jadwal tercatat.';
    get('admin-records').replaceChildren(...(items.length ? items : [listElement('li', emptyMessage)]));
    get('admin-schedule-count').textContent = schedules.length + ' entri';
    get('admin-more').hidden = schedules.length <= limit;
  }

  function readSchedule() {
    const values = new FormData(form);
    const lecturerIds = values.getAll('lecturerId').filter(Boolean).map(Number);
    values.delete('lecturerId');
    return { input: { ...Object.fromEntries(values), type: kind }, lecturerIds };
  }

  function showConflicts() {
    const output = get('admin-conflicts');
    const { input, lecturerIds } = readSchedule();
    let conflicts = [];
    try {
      const draft = model.scheduleInput({ ...input, lecturerId: lecturerIds[0], title: input.title || 'Rancangan jadwal' });
      conflicts = lecturerIds.flatMap((lecturerId) => model.conflictsWith(data.schedules, { ...draft, lecturerId }));
    } catch {}
    const names = new Map(data.lecturers.map(({ id, name }) => [id, name]));
    output.hidden = conflicts.length === 0;
    output.textContent = conflicts.length
      ? 'Bentrok dengan ' + conflicts.map((entry) =>
        names.get(entry.lecturerId) + ' · ' + model.labels[entry.type].toLowerCase() + ' ' + entry.title + ' (' +
        (entry.through ? 'setiap ' + weekdayFormat.format(toDate(entry.date)) : displayDate(entry.date)) +
        ', ' + entry.start + '–' + entry.end + ' WIB)').join('; ') + '.'
      : '';
  }

  function updateRepeat() {
    const weekly = kind !== 'trip' && field('repeat').value === 'weekly';
    get('admin-through').hidden = !weekly;
    field('through').disabled = !weekly;
    field('through').required = weekly;
    field('through').min = field('date').value;
    get('admin-date-label').textContent = weekly ? 'Tanggal pertama' : 'Tanggal';
  }

  for (const button of kindButtons) {
    button.addEventListener('click', () => {
      kind = button.dataset.kind;
      for (const control of kindButtons) control.setAttribute('aria-pressed', String(control === button));
      get('admin-title-label').textContent = titleLabels[kind];
      field('title').placeholder = placeholders[kind];
      get('admin-teaching-details').hidden = kind !== 'teach';
      field('teachingProgram').disabled = kind !== 'teach';
      field('semester').disabled = kind !== 'teach';
      get('admin-repeat').hidden = kind === 'trip';
      updateRepeat();
      showConflicts();
      status('admin-schedule-status', '');
    });
  }

  addScheduleLecturer.addEventListener('click', () => {
    const row = get('admin-schedule-lecturer-row').content.firstElementChild.cloneNode(true);
    const select = row.querySelector('select');
    fillLecturerSelect(select, sortedLecturers());
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      updateLecturerOptions();
      showConflicts();
      status('admin-schedule-status', '');
      addScheduleLecturer.focus();
    });
    scheduleLecturers.append(row);
    updateLecturerOptions();
    select.focus();
  });

  form.addEventListener('input', () => {
    updateLecturerOptions();
    updateRepeat();
    showConflicts();
    status('admin-schedule-status', '');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = form.querySelector('fieldset');
    try {
      const { input, lecturerIds } = readSchedule();
      const entry = model.scheduleInput({ ...input, lecturerId: lecturerIds[0] });
      fields.disabled = true;
      for (const button of kindButtons) button.disabled = true;
      const rows = lecturerIds.length === 1
        ? [await store.addSchedule(entry)] : await store.addSchedules(input, lecturerIds);
      data.schedules.unshift(...rows.reverse());
      updates?.postMessage('updated');
      field('title').value = '';
      field('semester').value = '';
      field('teachingProgram').value = '';
      get('admin-conflicts').hidden = true;
      resetRecordFilters();
      status('admin-schedule-status', 'Jadwal berhasil disimpan untuk ' + rows.length + ' dosen.');
    } catch (error) {
      status('admin-schedule-status', error.message, true);
    } finally {
      fields.disabled = false;
      for (const button of kindButtons) button.disabled = false;
    }
  });

  directory.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = directory.querySelector('fieldset');
    try {
      const input = model.lecturerInput(Object.fromEntries(new FormData(directory)));
      fields.disabled = true;
      const lecturer = await store.addLecturer(input);
      data.lecturers.push(lecturer);
      updates?.postMessage('updated');
      renderLecturers(String(lecturer.id));
      directory.reset();
      status('admin-lecturer-status', lecturer.name + ' ditambahkan dan dipilih di form jadwal.');
      showConflicts();
    } catch (error) {
      status('admin-lecturer-status', error.message, true);
    } finally {
      fields.disabled = false;
    }
  });

  const importErrors = get('admin-import-errors');
  get('admin-directory-link').addEventListener('click', () => {
    get('admin-directory').open = true;
  });
  function showImportErrors(rows = []) {
    importErrors.replaceChildren(...rows.map(({ row, message }) => listElement('li', 'Baris ' + row + ' · ' + message)));
    importErrors.hidden = rows.length === 0;
  }

  importForm.addEventListener('change', () => {
    status('admin-import-status', '');
    showImportErrors();
  });
  importForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { type, workbook } = Object.fromEntries(new FormData(importForm));
    showImportErrors();
    if (fieldsets.some((fields) => fields.disabled)) {
      status('admin-import-status', 'Tunggu penyimpanan yang sedang berjalan.', true);
      return;
    }
    if (!workbook || !/\.xlsx$/i.test(workbook.name) || !workbook.size || workbook.size > 2 * 1024 * 1024) {
      status('admin-import-status', 'Pilih file .xlsx berukuran maksimal 2 MB.', true);
      return;
    }
    fieldsets.forEach((fields) => { fields.disabled = true; });
    status('admin-import-status', 'Membaca file Excel…');
    try {
      const result = await store.importExcel(type, workbook);
      updates?.postMessage('updated');
      data = result.data;
      renderLecturers();
      resetRecordFilters();
      importForm.elements.namedItem('workbook').value = '';
      const updated = result.updated ? ' Rincian ' + result.updated + ' jadwal lama diperbarui.' : '';
      status('admin-import-status',
        result.imported + ' jadwal ditambahkan.' + updated + ' ' + result.skipped + ' duplikat dilewati.');
    } catch (error) {
      status('admin-import-status', error.message, true);
      showImportErrors(error.rows);
      if (error.rows?.length) get('admin-directory').open = true;
    } finally {
      fieldsets.forEach((fields) => { fields.disabled = false; });
      showConflicts();
    }
  });

  for (const input of recordFilters) {
    input.addEventListener('input', () => {
      limit = 6;
      renderList();
    });
  }
  get('admin-more').addEventListener('click', () => {
    limit += 6;
    renderList();
  });
  async function load() {
    try {
      data = await store.load();
      renderLecturers();
      renderList();
      if (!data.lecturers.length) get('admin-directory').open = true;
      form.querySelector('fieldset').disabled = false;
      directory.querySelector('fieldset').disabled = false;
      importForm.querySelector('fieldset').disabled = false;
      field('date').value = store.initialDate;
      updateRepeat();
    } catch {
      status('admin-schedule-status', 'Data belum bisa dimuat. Jalankan server admin lalu muat ulang halaman.', true);
    }
  }
  load();
})();
