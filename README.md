# Penjadwalan Dosen Fakultas Teknik

Dashboard lokal untuk mengelola jadwal mengajar, piket, dan tugas luar dosen Fakultas Teknik. Aplikasi menggunakan Node.js, SQLite, dan ExcelJS.

## Fitur

- **Kalender bulanan** menampilkan jumlah kegiatan tugas luar dan jadwal mengajar per tanggal. Pilih tanggal untuk melihat agenda, jam, nama dosen, dan bentrok jadwal.
- **Rincian mengajar** menampilkan semester mahasiswa dan prodi tujuan. Jadwal dikelompokkan dengan urutan TI, Mesin, lalu Sipil. Prodi asal tetap terlihat pada rincian dosen.
- **Rekap tugas luar** menampilkan jumlah kegiatan per dosen sampai tanggal pilihan, termasuk proyeksi jika memilih tanggal mendatang. Kegiatan yang diikuti beberapa dosen dihitung sekali di kalender dan sekali untuk tiap dosen di rekap.
- **Dashboard Admin** menyediakan daftar dosen, penambahan beberapa dosen dalam satu jadwal, perubahan tanggal atau peserta tugas luar, serta pencarian jadwal berdasarkan nama dosen, hari, tanggal, atau agenda.
- **Impor Excel** menyediakan template jadwal mengajar dan tugas luar dengan pilihan nama dan prodi dari daftar dosen.

## Menjalankan aplikasi

Pasang **Node.js 24**. Jalankan perintah berikut di PowerShell dari folder `dashboard-piket-ft`.

```powershell
npm ci
node .\server.mjs
```

Biarkan jendela PowerShell terbuka selama aplikasi dipakai.

- [Kalender Dosen](http://127.0.0.1:4175/)
- [Dashboard Admin](http://127.0.0.1:4175/admin)

Jika port `4175` sedang dipakai, pilih port lain. Contoh berikut memakai `4177`.

```powershell
$env:FT_PORT = '4177'
node .\server.mjs
```

Buka [Kalender Dosen](http://127.0.0.1:4177/) atau [Dashboard Admin](http://127.0.0.1:4177/admin) melalui port tersebut. Setelah dependensi terpasang, aplikasi dapat digunakan tanpa internet.

## Mengelola jadwal

1. Tambahkan nama dan program studi dosen melalui **Tambah dosen**.
2. Pilih **Mengajar**, **Tugas luar**, atau **Piket**, lalu masukkan agenda, tanggal, dan jam dalam WIB. Gunakan **Tambah dosen ke jadwal** jika beberapa dosen mengikuti agenda yang sama.
3. Untuk jadwal mengajar atau piket berulang, pilih **Setiap minggu**. Tanggal pertama menentukan hari pengulangan, dan tanggal akhir membatasi periode jadwal.
4. Tinjau peringatan bentrok sebelum menyimpan. Untuk memperbarui tugas luar, cari kegiatannya di **Jadwal tersimpan**, lalu pilih **Ubah tanggal** atau **Ubah peserta**.

## Impor Excel

Daftarkan dosen di Dashboard Admin terlebih dahulu. Unduh template **Jadwal Mengajar** atau **Tugas Luar** dari panel **Impor Excel** agar pilihan nama dan prodi sesuai dengan data terbaru. Isi tab data mulai baris 2 dengan satu dosen per baris, pilih jenis jadwal, lalu unggah file `.xlsx`. Batasnya 2 MB dan 1.000 baris per file.

Untuk jadwal mengajar, isi **Program Studi** dengan prodi asal dosen. Isi **Prodi Tujuan** jika kelas diajar di prodi lain. **Semester** berisi angka semester mahasiswa, misalnya `1`.

Gunakan satu baris untuk setiap kombinasi dosen, mata kuliah, hari, dan jam mengajar. Sistem menjadwalkan pertemuan pertama pada **Hari** yang dipilih, pada atau setelah tanggal **Awal Semester**, lalu mengulanginya setiap minggu sampai **Akhir Semester**.

Jika baris cocok dengan jadwal yang sudah tersimpan, impor dapat mengisi semester yang kosong atau memperbarui prodi tujuan yang diisi. Duplikat tanpa perubahan dilewati. Jika ada data yang tidak valid, dashboard menampilkan nomor baris dan membatalkan impor.

## Berbagi kalender di jaringan lokal

Setelah database dibuat, buka PowerShell kedua di folder proyek. Ganti alamat contoh dengan IPv4 privat komputer yang menjalankan kalender.

```powershell
node .\server.mjs --share-calendar 192.168.0.61
```

Bagikan tautan yang muncul di PowerShell kepada pengguna di jaringan yang sama. Mode ini menyediakan kalender baca saja di port `4176`. Dashboard Admin lokal berjalan tanpa autentikasi dan hanya menerima koneksi dari komputer server.

## Database dan cadangan

`jadwal.sqlite` dibuat saat server admin pertama kali dijalankan. Repositori menyimpan kode dan template Excel. Git mengabaikan database lokal dan `node_modules`.

Untuk mencadangkan jadwal, hentikan server admin dan kalender, lalu salin `jadwal.sqlite` ke lokasi privat. Saat aplikasi pertama kali dijalankan dari salinan repositori di komputer lain, database baru akan kosong.
