NOORTEC Produktdatenblätter
===========================

Erwartete Dateien (stabile Namen):
  fronius-reserva.pdf
  fronius-symo-gen24-3-10.pdf
  fronius-symo-gen24sc-12.pdf
  fronius-symo.pdf
  fronius-smart-meter-ts.pdf
  sigen-hybrid-wechselrichter.pdf
  sigen-batterie.pdf
  huawei-sun2000-3-10ktl-m1.pdf
  aiko-mce54mb-460-490w.pdf
  das-dh108nd-440-465.pdf
  lg-standard-ii-single.pdf
  lg-mu2r15-4-1kw.pdf

Nicht abgelegt (kein eindeutiges öffentliches Datenblatt):
  SIG Energy Gateway (Home / HomePro / HomePro TP-L / HomeMax)
  Fronius Umschaltbox (Notstrom)
  SigenStor Smart Meter
  LG Multi-Außengerät 6,3 kW (Typencode fehlt im Katalog)

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
