import { createServer } from 'node:http';
import { isIPv4 } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import model from './schedule-model.cjs';
import { ExcelImportError, buildExcelTemplate, excelTemplates, maxExcelBytes, readExcelSchedules } from './import-excel.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/admin', ['admin.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/admin.css', ['admin.css', 'text/css']],
  ...['dashboard.js', 'admin.js', 'admin-api.js', 'schedule-model.cjs'].map((file) => [
    '/' + file, [file, 'text/javascript'],
  ]),
]);
const workbookMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const templateFiles = new Map(Object.values(excelTemplates).map((template) => ['/templates/' + template.filename, template]));
const sharedRoutes = new Set(['/', '/api/schedule', '/styles.css', '/dashboard.js', '/schedule-model.cjs']);

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) {
      request.resume();
      throw new RequestError('Data terlalu panjang.', 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readInput(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new RequestError('Gunakan data JSON.', 415);
  }
  const body = await readBody(request, 4096);
  try {
    const data = JSON.parse(body.toString('utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {}
  throw new RequestError('Data tidak valid.');
}

function validate(parse, data) {
  try {
    return parse(data);
  } catch (error) {
    throw new RequestError(error.message);
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

export function createApp(databasePath, { calendarOnly = false } = {}) {
  const db = new DatabaseSync(databasePath, { readOnly: calendarOnly });
  db.exec('PRAGMA busy_timeout = 3000');
  if (!calendarOnly) db.exec(`
    CREATE TABLE IF NOT EXISTS lecturers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      program TEXT NOT NULL COLLATE NOCASE,
      UNIQUE (name, program)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY,
      lecturer_id INTEGER NOT NULL REFERENCES lecturers(id),
      type TEXT NOT NULL CHECK (type IN ('teach', 'duty', 'trip')),
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      through TEXT,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      semester INTEGER CHECK (semester IS NULL OR (type = 'teach' AND semester >= 1)),
      teaching_program TEXT CHECK (teaching_program IS NULL OR (type = 'teach' AND length(trim(teaching_program)) > 0)),
      CHECK (start < end),
      CHECK (through IS NULL OR (type <> 'trip' AND through >= date))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS unique_schedule
      ON schedules (lecturer_id, type, title, date, coalesce(through, ''), start, end);
  `);
  const scheduleColumns = () => new Set(db.prepare('PRAGMA table_info(schedules)').all().map(({ name }) => name));
  let columns = scheduleColumns();
  if (!calendarOnly && (!columns.has('semester') || !columns.has('teaching_program'))) {
    db.exec('BEGIN IMMEDIATE');
    try {
      columns = scheduleColumns();
      if (!columns.has('semester')) db.exec("ALTER TABLE schedules ADD COLUMN semester INTEGER CHECK (semester IS NULL OR (type = 'teach' AND semester >= 1))");
      if (!columns.has('teaching_program')) db.exec("ALTER TABLE schedules ADD COLUMN teaching_program TEXT CHECK (teaching_program IS NULL OR (type = 'teach' AND length(trim(teaching_program)) > 0))");
      db.exec('COMMIT');
      columns = scheduleColumns();
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  const semesterColumn = columns.has('semester') ? 'semester' : 'NULL AS semester';
  const programColumn = columns.has('teaching_program') ? 'teaching_program' : 'NULL';
  const allLecturers = db.prepare('SELECT id, name, program FROM lecturers ORDER BY name, program');
  const allSchedules = db.prepare(
    `SELECT id, lecturer_id AS lecturerId, type, title, date, through, start, end, ${semesterColumn},
      ${programColumn} AS teachingProgram FROM schedules ORDER BY id DESC`,
  );
  const findLecturer = db.prepare('SELECT id, name, program FROM lecturers WHERE id = ?');
  const insertLecturer = db.prepare('INSERT OR IGNORE INTO lecturers (name, program) VALUES (?, ?) RETURNING id');
  const insertSchedule = !calendarOnly && db.prepare(
    `INSERT OR IGNORE INTO schedules (lecturer_id, type, title, date, through, start, end, semester, teaching_program)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const updateTeachingDetails = !calendarOnly && db.prepare(`
    UPDATE schedules SET semester = coalesce(semester, $semester), teaching_program = coalesce($teachingProgram, teaching_program)
    WHERE lecturer_id = $lecturerId AND type = 'teach' AND title = $title AND date = $date
      AND through IS $through AND start = $start AND end = $end
      AND ((semester IS NULL AND $semester IS NOT NULL)
        OR ($teachingProgram IS NOT NULL AND teaching_program IS NOT $teachingProgram))
  `);
  const findTrip = db.prepare(
    "SELECT id, lecturer_id AS lecturerId, type, title, date, through, start, end FROM schedules WHERE id = ? AND type = 'trip'",
  );
  const updateTripDate = db.prepare(
    "UPDATE OR IGNORE schedules SET date = ? WHERE id = ? AND type = 'trip' AND date = ? RETURNING date",
  );
  const tripParticipants = db.prepare(`
    SELECT id, lecturer_id AS lecturerId, type, title, date, through, start, end
    FROM schedules WHERE type = 'trip' AND title = ? AND date = ? AND start = ? AND end = ?
    ORDER BY id DESC
  `);
  const deleteTripParticipant = db.prepare("DELETE FROM schedules WHERE id = ? AND type = 'trip'");
  const snapshot = () => ({ lecturers: allLecturers.all(), schedules: allSchedules.all() });

  function saveSchedule(entry) {
    return insertSchedule.get(entry.lecturerId, entry.type, entry.title, entry.date, entry.through, entry.start, entry.end,
      entry.semester ?? null, entry.teachingProgram ?? null);
  }

  function addSchedule(entry, batch = false) {
    const lecturer = findLecturer.get(entry.lecturerId);
    if (!lecturer) throw new RequestError('Dosen belum terdaftar.');
    const row = saveSchedule(entry);
    if (!row) {
      const message = batch ? 'Jadwal yang sama sudah tercatat untuk ' + lecturer.name + ' · ' + lecturer.program + '.'
        : 'Jadwal yang sama sudah tercatat.';
      throw new RequestError(message, 409);
    }
    return { id: row.id, ...entry };
  }

  function addSchedules({ lecturerIds, ...input }) {
    if (!Array.isArray(lecturerIds) || lecturerIds.length === 0) throw new RequestError('Pilih minimal satu dosen.');
    const entries = lecturerIds.map((lecturerId) => validate(model.scheduleInput, { ...input, lecturerId }));
    if (new Set(entries.map(({ lecturerId }) => lecturerId)).size !== entries.length) {
      throw new RequestError('Pilih setiap dosen satu kali.');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const rows = entries.map((entry) => addSchedule(entry, true));
      db.exec('COMMIT');
      return rows;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function editTripDate(id, { date, previousDate }) {
    if (!Number.isSafeInteger(id) || !model.validDate(date) || !model.validDate(previousDate)) {
      throw new RequestError('Pilih tanggal tugas luar yang valid.');
    }
    const trip = findTrip.get(id);
    if (!trip) throw new RequestError('Tugas luar tidak ditemukan.', 404);
    if (trip.date === date) return trip;
    if (trip.date !== previousDate) throw new RequestError('Tanggal sudah diubah. Muat ulang dashboard sebelum mencoba lagi.', 409);
    if (!updateTripDate.get(date, id, previousDate)) {
      const current = findTrip.get(id);
      if (current?.date === date) return current;
      if (current?.date !== previousDate) throw new RequestError('Tanggal sudah diubah. Muat ulang dashboard sebelum mencoba lagi.', 409);
      throw new RequestError('Tugas luar yang sama sudah tercatat pada tanggal tersebut.', 409);
    }
    return { ...trip, date };
  }

  function editTripParticipants(id, { title, date, start, end, lecturerIds, previousLecturerIds }) {
    const validIds = (ids) => Array.isArray(ids) && ids.length > 0
      && ids.every((value) => Number.isSafeInteger(value) && value > 0)
      && new Set(ids).size === ids.length;
    if (!Number.isSafeInteger(id) || !model.validDate(date) || !validIds(lecturerIds) || !validIds(previousLecturerIds)) {
      throw new RequestError('Pilih minimal satu dosen terdaftar.');
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const trip = findTrip.get(id);
      if (!trip) throw new RequestError('Tugas luar tidak ditemukan. Muat ulang dashboard.', 404);
      const slot = [trip.title, trip.date, trip.start, trip.end];
      const current = tripParticipants.all(...slot);
      const existing = new Set(current.map((row) => row.lecturerId));
      if (trip.title !== title || trip.date !== date || trip.start !== start || trip.end !== end
        || existing.size !== previousLecturerIds.length
        || !previousLecturerIds.every((lecturerId) => existing.has(lecturerId))) {
        throw new RequestError('Jadwal atau peserta sudah berubah. Muat ulang dashboard sebelum mencoba lagi.', 409);
      }
      for (const lecturerId of lecturerIds) {
        if (!findLecturer.get(lecturerId)) throw new RequestError('Dosen belum terdaftar.');
        if (!existing.has(lecturerId) && !saveSchedule({ ...trip, lecturerId })) {
          throw new RequestError('Peserta sudah tercatat untuk tugas luar ini.', 409);
        }
      }
      const selected = new Set(lecturerIds);
      for (const row of current) {
        if (!selected.has(row.lecturerId)) deleteTripParticipant.run(row.id);
      }
      const updated = tripParticipants.all(...slot);
      db.exec('COMMIT');
      return updated;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function importSchedules(items) {
    const counts = { imported: 0, updated: 0, skipped: 0 };
    db.exec('BEGIN IMMEDIATE');
    try {
      const roster = Map.groupBy(allLecturers.all(), model.lecturerIdentity);
      const errors = [];
      const schedules = [];
      for (const { row, lecturer, schedule } of items) {
        const matches = roster.get(model.lecturerIdentity(lecturer)) ?? [];
        if (matches.length === 1) {
          schedules.push({ ...schedule, lecturerId: matches[0].id });
        } else {
          const label = lecturer.name + ' · ' + lecturer.program;
          const message = matches.length
            ? 'Ada lebih dari satu entri untuk ' + label + '. Periksa daftar dosen.'
            : label + ' belum terdaftar. Cocokkan nama dan prodi dengan daftar dosen atau daftarkan dulu.';
          errors.push({ row, message });
        }
      }
      if (errors.length) {
        throw new ExcelImportError(errors.length + ' baris perlu dicocokkan dengan daftar dosen. Impor dibatalkan.', errors.slice(0, 20));
      }
      for (const schedule of schedules) {
        const { semester, teachingProgram, lecturerId, title, date, through, start, end } = schedule;
        const updated = (semester || teachingProgram) && updateTeachingDetails.run({
          $semester: semester, $teachingProgram: teachingProgram, $lecturerId: lecturerId, $title: title,
          $date: date, $through: through, $start: start, $end: end,
        }).changes;
        if (updated) counts.updated++;
        else if (saveSchedule(schedule)) counts.imported++;
        else counts.skipped++;
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { ...counts, data: snapshot() };
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const { pathname } = url;
      if (calendarOnly && (request.method !== 'GET' || !sharedRoutes.has(pathname))) {
        return sendJson(response, 404, { error: 'Halaman tidak ditemukan.' });
      }
      if (request.method === 'GET' && pathname === '/api/schedule') {
        if (calendarOnly) return sendJson(response, 200, { ...snapshot(), calendarOnly: true });
        return sendJson(response, 200, snapshot());
      }
      const tripEdit = request.method === 'PATCH' && /^\/api\/schedules\/([1-9]\d*)\/(date|participants)$/.exec(pathname);
      if (tripEdit || (request.method === 'POST' && ['/api/lecturers', '/api/schedules', '/api/import-excel'].includes(pathname))) {
        // Accept writes from the local admin page or command-line clients only.
        const origin = request.headers.origin;
        const host = request.headers.host;
        if (origin && (origin !== 'http://' + host || !/^127\.0\.0\.1(?::\d+)?$/.test(host))) {
          throw new RequestError('Permintaan harus berasal dari dashboard admin lokal.', 403);
        }
        if (pathname === '/api/import-excel') {
          if (request.headers['content-type'] !== workbookMime) throw new RequestError('Gunakan file .xlsx.', 415);
          const bytes = await readBody(request, maxExcelBytes);
          const items = await readExcelSchedules(bytes, url.searchParams.get('type'));
          return sendJson(response, 200, importSchedules(items));
        }
        const input = await readInput(request);
        if (tripEdit) {
          const edit = tripEdit[2] === 'date' ? editTripDate : editTripParticipants;
          return sendJson(response, 200, edit(Number(tripEdit[1]), input));
        }
        if (pathname === '/api/lecturers') {
          const lecturer = validate(model.lecturerInput, input);
          const key = model.lecturerIdentity(lecturer);
          if (allLecturers.all().some((entry) => model.lecturerIdentity(entry) === key)) {
            throw new RequestError('Dosen tersebut sudah terdaftar di program studi ini.', 409);
          }
          const { name, program } = lecturer;
          const row = insertLecturer.get(name, program);
          if (!row) throw new RequestError('Dosen tersebut sudah terdaftar di program studi ini.', 409);
          return sendJson(response, 201, { id: row.id, name, program });
        }
        const result = Object.hasOwn(input, 'lecturerIds')
          ? addSchedules(input) : addSchedule(validate(model.scheduleInput, input));
        return sendJson(response, 201, result);
      }
      const template = request.method === 'GET' && templateFiles.get(pathname);
      if (template) {
        const base = await readFile(new URL('outputs/01a1c316-fe2c-7b11-a61a-fa4005b02a03/' + template.filename, import.meta.url));
        const data = await buildExcelTemplate(base, template, allLecturers.all());
        response.writeHead(200, {
          'Content-Type': workbookMime,
          'Content-Disposition': 'attachment; filename="' + template.filename + '"',
          'Cache-Control': 'no-store',
        });
        return response.end(data);
      }
      const asset = request.method === 'GET' && files.get(pathname);
      if (asset) {
        const [file, contentType] = asset;
        const data = await readFile(new URL(file, import.meta.url));
        response.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        return response.end(data);
      }
      return sendJson(response, 404, { error: 'Halaman tidak ditemukan.' });
    } catch (error) {
      if (error instanceof ExcelImportError) return sendJson(response, 422, { error: error.message, rows: error.rows });
      if (!(error instanceof RequestError)) console.error(error);
      return sendJson(response, error.status || 500, { error: error.status ? error.message : 'Penyimpanan sedang bermasalah.' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databasePath = fileURLToPath(new URL('jadwal.sqlite', import.meta.url));
  const args = process.argv.slice(2);
  if (!args.length) {
    const port = Number(process.env.FT_PORT || 4175);
    createApp(databasePath).listen(port, '127.0.0.1', () => {
      console.log('Dashboard admin  http://127.0.0.1:' + port + '/admin');
      console.log('Kalender dosen    http://127.0.0.1:' + port + '/');
    });
  } else {
    const [mode, host] = args;
    const privateAddress = isIPv4(host ?? '') && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host);
    if (args.length !== 2 || mode !== '--share-calendar' || !privateAddress) {
      console.error('Gunakan --share-calendar diikuti alamat IPv4 privat dari Wi-Fi atau Ethernet komputer ini.');
      process.exitCode = 1;
    } else {
      const port = 4176;
      const shared = createApp(databasePath, { calendarOnly: true });
      shared.on('error', (error) => {
        console.error('Kalender tidak bisa dibagikan di ' + host + ':' + port + ' (' + error.code + '). Periksa alamat dan port.');
        process.exitCode = 1;
      });
      shared.listen(port, host, () => console.log('Bagikan tautan kalender: http://' + host + ':' + port + '/'));
    }
  }
}
