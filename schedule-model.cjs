(() => {
  const labels = { teach: 'Mengajar', duty: 'Piket', trip: 'Tugas luar' };
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const asDate = (date) => new Date(date + 'T00:00:00Z');

  function validDate(date) {
    return typeof date === 'string' && datePattern.test(date)
      && Number.isFinite(asDate(date).getTime()) && asDate(date).toISOString().slice(0, 10) === date;
  }

  function requiredText(value, label) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > 120) throw new Error(label + ' wajib diisi, maksimal 120 karakter.');
    return text;
  }

  function lecturerInput(input) {
    const name = requiredText(input.name, 'Nama dosen');
    if (/[\/;&\r\n]/.test(name)) {
      throw new Error('Isi satu nama dosen per baris. Pisahkan jadwal yang melibatkan beberapa dosen.');
    }
    return { name: name.replace(/\s+/g, ' '), program: requiredText(input.program, 'Program studi').replace(/\s+/g, ' ') };
  }

  function lecturerIdentity({ name, program }) {
    return JSON.stringify([name, program].map((part) => part.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()));
  }

  function scheduleInput(input) {
    const { type, date, start, end } = input;
    const title = requiredText(input.title, 'Nama kegiatan');
    const lecturerId = Number(input.lecturerId);
    const through = input.through || null;
    const value = input.semester;
    let semester = null;
    if (!Object.hasOwn(labels, type)) throw new Error('Kategori jadwal tidak dikenal.');
    if ((typeof input.lecturerId !== 'number' && typeof input.lecturerId !== 'string')
      || !Number.isSafeInteger(lecturerId) || lecturerId < 1) throw new Error('Pilih dosen.');
    if (!validDate(date)) throw new Error('Pilih tanggal yang valid.');
    if (typeof start !== 'string' || typeof end !== 'string' || !timePattern.test(start) || !timePattern.test(end) || end <= start) {
      throw new Error('Jam selesai harus setelah jam mulai pada tanggal yang sama.');
    }
    if (through && (type === 'trip' || !validDate(through) || through < date)) {
      throw new Error('Tanggal akhir pengulangan harus sama dengan atau setelah tanggal pertama.');
    }
    if (type === 'teach' && value != null && !(typeof value === 'string' && !value.trim())) {
      const number = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim())) ? Number(value) : NaN;
      if (!Number.isSafeInteger(number) || number < 1) throw new Error('Isi semester dengan angka bulat mulai dari 1.');
      semester = number;
    }
    const destination = input.teachingProgram;
    const teachingProgram = type === 'teach' && destination != null
      && !(typeof destination === 'string' && !destination.trim())
      ? requiredText(destination, 'Prodi tujuan').replace(/\s+/g, ' ')
      : null;
    return { type, title, lecturerId, date, through, start, end, semester, teachingProgram };
  }

  function appliesOn(event, date) {
    if (!event.through) return event.date === date;
    return event.date <= date && date <= event.through && asDate(event.date).getUTCDay() === asDate(date).getUTCDay();
  }

  function conflictsWith(events, proposed) {
    return events.filter((event) => {
      if (event.lecturerId !== proposed.lecturerId || event.start >= proposed.end || proposed.start >= event.end) return false;
      if (!proposed.through) return appliesOn(event, proposed.date);
      if (!event.through) return appliesOn(proposed, event.date);
      if (asDate(event.date).getUTCDay() !== asDate(proposed.date).getUTCDay()) return false;
      // The later start date is an occurrence of both weekly series if their ranges overlap.
      return event.date <= proposed.through && proposed.date <= event.through;
    });
  }

  const model = { labels, validDate, lecturerInput, lecturerIdentity, scheduleInput, appliesOn, conflictsWith };
  if (typeof module === 'object' && module.exports) module.exports = model;
  else globalThis.ftScheduleModel = model;
})();
