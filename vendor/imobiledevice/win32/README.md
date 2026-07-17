# libimobiledevice для Windows (опционально)

Эти бинарники нужны **только для показа заряда и имени телефона** на Windows.
Прокси работает и без них.

Положи сюда `.exe` и `.dll` из Windows-сборки libimobiledevice:

- `idevice_id.exe`
- `ideviceinfo.exe`
- сопутствующие библиотеки (`libimobiledevice*.dll`, `libplist*.dll`,
  `libusbmuxd*.dll`, `libcrypto*.dll`, `libssl*.dll` и т.п.)

Где взять готовые сборки:

- https://github.com/libimobiledevice-win32/imobiledevice-net/releases
- или собрать из https://github.com/libimobiledevice/libimobiledevice

При сборке приложения (`npm run dist:win`) содержимое этой папки попадёт в
`resources/imobiledevice` внутри установленной программы, и приложение найдёт
их автоматически.

> Для самой работы iPhone как модема на Windows нужен драйвер Apple —
> установи **Apple Devices** из Microsoft Store (или iTunes).
