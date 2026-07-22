NOORTEC Produktdatenblätter
===========================

Erwartete Dateien (stabile Namen):
  fronius-reserva.pdf
  fronius-symo-gen24-3-10.pdf
  fronius-symo-gen24sc-12.pdf
  sigen-hybrid-wechselrichter.pdf
  sigen-batterie.pdf
  aiko-mce54mb-460-490w.pdf
  das-dh108nd-440-465.pdf

Öffentlich erreichbar unter:
  https://pvl.lifeco.at/datenblaetter/<dateiname>

Import von Windows Downloads (PowerShell):
  scp -i C:\Users\cflip\.ssh\id_ed25519 `
    "$env:USERPROFILE\Downloads\SE_DB_Fronius_Reserva_DE (1).pdf" `
    "$env:USERPROFILE\Downloads\SE_DS_Fronius_Symo_GEN24_GEN24Plus_3_to_10_kW_DE (1).pdf" `
    "$env:USERPROFILE\Downloads\SE_DS_Fronius_Symo_GEN24SC_12kW_DE (1).pdf" `
    "$env:USERPROFILE\Downloads\Energielösung für Zuhause - Sigen Hybrid Wechselrichter.pdf" `
    "$env:USERPROFILE\Downloads\Energielösung für Zuhause - Sigen Batterie.pdf" `
    "$env:USERPROFILE\Downloads\AIKO A MCE54Mb 460 490W.pdf" `
    "$env:USERPROFILE\Downloads\DAS-DH108ND_440-465_Schwarzer Rahmen_Datenblatt_DE-1.pdf" `
    root@46.224.167.109:/tmp/datenblaetter-upload/

Dann auf dem Server:
  mkdir -p /tmp/datenblaetter-upload
  bash /root/pv-lead-manager/scripts/import-datenblaetter.sh /tmp/datenblaetter-upload
