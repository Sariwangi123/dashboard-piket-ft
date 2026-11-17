import ExcelJS from 'exceljs';
import model from './schedule-model.cjs';

const weeklyTeachingHeaders = ['Nama Dosen', 'Program Studi', 'Mata Kuliah', 'Hari', 'Awal Semester', 'Akhir Semester', 'Jam Mulai', 'Jam Selesai'];
const semesterTeachingHeaders = [...weeklyTeachingHeaders, 'Semester'];
export const excelTemplates = {
  teach: {
    sheet: 'Jadwal Mengajar',
    filename: 'template-jadwal-mengajar.xlsx',
    headers: [...semesterTeachingHeaders, 'Prodi Tujuan'],
  },
  trip: {
    sheet: 'Tugas Luar',
    filename: 'template-tugas-luar.xlsx',
    headers: ['Nama Dosen', 'Program Studi', 'Nama Penugasan', 'Tanggal', 'Jam Mulai', 'Jam Selesai'],
  },
};
export const maxExcelBytes = 2 * 1024 * 1024;
const maxRows = 1000;
const dayMs = 86_400_000;
const weekdays = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
const legacyTeachingHeaders = ['Nama Dosen', 'Program Studi', 'Mata Kuliah', 'Tanggal Pertama', 'Jam Mulai', 'Jam Selesai', 'Ulangi Hingga'];

export async function buildExcelTemplate(bytes, template, lecturers) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const data = workbook.getWorksheet(template.sheet);
  const guide = workbook.getWorksheet('Petunjuk');
  if (template === excelTemplates.teach) {
    const column = data.getColumn('I');
    column.width = 14;
    column.numFmt = '0';
    const header = data.getCell('I1');
    header.style = { ...data.getCell('H1').style, numFmt: 'General' };
    header.value = 'Semester';
    data.dataValidations.add('I2:I' + (maxRows + 1), {
      type: 'whole', operator: 'greaterThanOrEqual', formulae: [1], allowBlank: true,
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Semester tidak valid',
      error: 'Isi dengan angka bulat mulai dari 1.',
    });
    ['Semester', 'Nomor semester mahasiswa untuk mata kuliah ini. Isi dengan angka bulat.', 3].forEach((value, index) => {
      const cell = guide.getRow(14).getCell(index + 1);
      cell.style = { ...guide.getRow(13).getCell(index + 1).style, numFmt: 'General' };
      cell.value = value;
    });
    data.getColumn('J').width = 23;
    data.getCell('J1').style = { ...header.style };
    data.getCell('J1').value = 'Prodi Tujuan';
    const destination = guide.insertRow(15, ['Prodi Tujuan', 'Isi prodi tempat mata kuliah diajar. Boleh kosong jika sama dengan prodi asal dosen.', 'Sipil'], 'i');
    destination.height = 32;
  }
  guide.getCell('B6').value = 'Pilih nama dari dropdown. Lihat tab Daftar Dosen untuk mengecek prodi.';
  guide.getCell('B7').value = 'Pilih prodi asal yang terdaftar untuk dosen tersebut.';
  guide.getCell('C6').value = lecturers[0]?.name ?? null;
  guide.getCell('C7').value = lecturers[0]?.program ?? null;

  const roster = workbook.addWorksheet('Daftar Dosen', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  roster.columns = [
    { header: 'Nama Dosen', width: 32 },
    { header: 'Program Studi', width: 28 },
    { hidden: true },
    { hidden: true },
  ];
  const header = roster.getRow(1);
  header.height = 25;
  for (const column of [1, 2]) {
    const cell = header.getCell(column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16395B' } };
    cell.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle' };
  }
  if (!lecturers.length) {
    roster.getCell('A2').value = 'Belum ada dosen terdaftar.';
    guide.getCell('B6').value = 'Daftarkan dosen di Dashboard Admin, lalu unduh ulang template.';
    return workbook.xlsx.writeBuffer();
  }

  roster.addRows(lecturers.map(({ name, program }) => [name, program]));
  for (const [column, field, listColumn, rangeName] of [
    ['A', 'name', 'C', 'NamaDosenTerdaftar'],
    ['B', 'program', 'D', 'ProdiTerdaftar'],
  ]) {
    const options = new Map();
    for (const lecturer of lecturers) {
      const value = lecturer[field];
      const key = model.lecturerIdentity({ name: value, program: '' });
      if (!options.has(key)) options.set(key, value);
    }
    [...options.values()].forEach((value, index) => { roster.getCell(listColumn + (index + 2)).value = value; });
    workbook.definedNames.add("'Daftar Dosen'!$" + listColumn + '$2:$' + listColumn + '$' + (options.size + 1), rangeName);
    data.dataValidations.add(column + '2:' + column + (maxRows + 1), {
      type: 'list',
      allowBlank: true,
      formulae: [rangeName],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Pilihan belum terdaftar',
      error: 'Pilih nilai dari dropdown. Unduh ulang template jika daftar dosen berubah.',
    });
    if (template === excelTemplates.teach && field === 'program') {
      data.dataValidations.add('J2:J' + (maxRows + 1), {
        type: 'list', allowBlank: true, formulae: [rangeName],
      });
    }
  }
  return workbook.xlsx.writeBuffer();
}

export class ExcelImportError extends Error {
  constructor(message, rows = []) {
    super(message);
    this.rows = rows;
    this.status = 422;
  }
}

function dateValue(value, epoch) {
  if (value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() % dayMs === 0) {
    return value.toISOString().slice(0, 10);
  }
  if (Number.isInteger(value) && value >= (epoch === -24107 ? 0 : 61) && value < 3_000_000) {
    return new Date((value + epoch) * dayMs).toISOString().slice(0, 10);
  }
  const text = typeof value === 'string' ? value.trim() : '';
  const localDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!localDate) return text;
  const [, day, month, year] = localDate;
  return [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
}

function timeValue(value, epoch) {
  const fraction = value instanceof Date ? value.getTime() / dayMs - epoch : value;
  if (typeof fraction === 'number' && fraction >= 0 && fraction < 1) {
    const minute = Math.round(fraction * 1440);
    if (minute < 1440 && Math.abs(fraction * 1440 - minute) < 0.0001) {
      return [Math.floor(minute / 60), minute % 60].map((part) => String(part).padStart(2, '0')).join(':');
    }
  }
  return typeof value === 'string' ? value.trim().replace(/^(\d):/, '0$1:') : '';
}

function isBlank(value) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function findColumns(header, labels) {
  if (header.actualCellCount !== labels.length) return null;
  const values = header.values;
  const columns = labels.map((label) => values.indexOf(label));
  return columns.includes(-1) ? null : columns;
}

function semesterTiming([day, first, last, start, end], epoch) {
  const weekday = typeof day === 'string' ? day.trim().toLowerCase().replace(/[’']/g, '') : '';
  const targetDay = weekdays.indexOf(weekday);
  if (targetDay < 0) throw new Error('Isi Hari dengan nama hari, misalnya Selasa.');

  const semesterStart = dateValue(first, epoch);
  const through = dateValue(last, epoch);
  if (!model.validDate(semesterStart) || !model.validDate(through) || through < semesterStart) {
    throw new Error('Awal dan Akhir Semester wajib diisi dengan tanggal valid. Akhir Semester harus sama dengan atau setelah Awal Semester.');
  }
  const firstDate = new Date(semesterStart + 'T00:00:00Z');
  const offset = (targetDay - firstDate.getUTCDay() + 7) % 7;
  const date = new Date(firstDate.getTime() + offset * dayMs).toISOString().slice(0, 10);
  if (!model.validDate(date) || date > through) {
    throw new Error('Hari mengajar yang dipilih tidak muncul dalam rentang semester ini.');
  }
  return { date, through, start, end };
}

function singleOrLegacyTiming([date, start, end, through], epoch) {
  return {
    date: dateValue(date, epoch),
    through: isBlank(through) ? null : dateValue(through, epoch) || 'invalid',
    start, end,
  };
}

export async function readExcelSchedules(bytes, type) {
  if (!Object.hasOwn(excelTemplates, type)) throw new ExcelImportError('Pilih jenis jadwal untuk impor.');
  const template = excelTemplates[type];
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    throw new ExcelImportError('File tidak bisa dibaca. Simpan sebagai .xlsx dan gunakan template yang sesuai.');
  }
  const sheet = workbook.getWorksheet(template.sheet);
  if (!sheet) throw new ExcelImportError('Tab ' + template.sheet + ' tidak ditemukan. Gunakan template yang sesuai.');
  const header = sheet.getRow(1);
  const currentColumns = findColumns(header, template.headers);
  const weeklyColumns = type === 'teach'
    ? (currentColumns ?? findColumns(header, semesterTeachingHeaders) ?? findColumns(header, weeklyTeachingHeaders))
    : null;
  const columns = weeklyColumns ?? currentColumns ?? (type === 'teach' ? findColumns(header, legacyTeachingHeaders) : null);
  if (!columns) {
    throw new ExcelImportError('Judul kolom pada baris 1 harus sesuai dengan template.');
  }
  const parseTiming = weeklyColumns ? semesterTiming : singleOrLegacyTiming;
  const epoch = workbook.properties.date1904 ? -24107 : -25569;
  const items = [];
  const errors = [];
  let rowCount = 0;
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const cells = columns.map((column) => row.getCell(column));
    const values = cells.map((cell) => cell.value);
    if (values.every(isBlank)) return;
    rowCount++;
    if (rowCount > maxRows) return;
    try {
      if (cells.some((cell) => cell.formula)) throw new Error('Ganti rumus dengan nilai sebelum mengimpor.');
      const [name, program, title, ...timing] = values;
      const lecturer = model.lecturerInput({ name, program });
      const { date, through, start, end } = parseTiming(timing, epoch);
      const schedule = model.scheduleInput({
        type, title, lecturerId: 1,
        date, through, semester: weeklyColumns ? timing[5] : null,
        teachingProgram: weeklyColumns ? timing[6] : null,
        start: timeValue(start, epoch),
        end: timeValue(end, epoch),
      });
      items.push({ row: number, lecturer, schedule });
    } catch (error) {
      errors.push({ row: number, message: error.message });
    }
  });
  if (rowCount > maxRows) throw new ExcelImportError('Maksimal 1.000 baris jadwal per file.');
  if (errors.length) {
    throw new ExcelImportError(errors.length + ' baris perlu diperbaiki. Impor dibatalkan.', errors.slice(0, 20));
  }
  if (!items.length) throw new ExcelImportError('Belum ada jadwal yang diisi mulai baris 2.');
  return items;
}
