(() => {
  async function readResponse(response) {
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { rows: result.rows });
    return result;
  }

  async function api(path, input, method = 'POST') {
    return readResponse(await fetch('/api/' + path, input ? {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    } : undefined));
  }
  window.ftAdminStore = {
    load: () => api('schedule'),
    addLecturer: (lecturer) => api('lecturers', lecturer),
    addSchedule: (schedule) => api('schedules', schedule),
    addSchedules: (schedule, lecturerIds) => api('schedules', { ...schedule, lecturerIds }),
    editTripDate: (id, date, previousDate) => api('schedules/' + id + '/date', { date, previousDate }, 'PATCH'),
    editTripParticipants: (id, input) => api('schedules/' + id + '/participants', input, 'PATCH'),
    importExcel: async (type, workbook) => readResponse(await fetch('/api/import-excel?type=' + encodeURIComponent(type), {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      body: workbook,
    })),
    initialDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', dateStyle: 'short' }).format(new Date()),
  };
})();
