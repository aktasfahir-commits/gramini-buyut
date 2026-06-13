# Gramını Büyüt

**Dokunuyorsan Senindir.**

Fiziksel altın ve külçe gümüş biriktirme alışkanlığı kazandıran gram odaklı bir PWA.
Fiyatlar değişir, gramlar kalır — burada ana metrik TL değil, **gram**.

## Teknoloji

- Vanilla HTML / CSS / JavaScript (build yok, npm yok)
- `localStorage` (versiyonlu veri şeması + migration)
- PWA (`manifest.webmanifest` + `service-worker.js`, çevrimdışı çalışır, kurulabilir)
- GitHub Pages (GitHub Actions ile otomatik deploy)

## Yerelde çalıştırma

Statik dosyalar olduğu için basit bir HTTP sunucusu yeterli (service worker `file://` üzerinde çalışmaz):

```bash
python -m http.server 8000
```

Ardından tarayıcıdan `http://localhost:8000` adresini aç.

## Dağıtım

`main` dalına yapılan her push'ta `.github/workflows/deploy.yml` çalışır ve statik dosyalar
doğrudan GitHub Pages'e dağıtılır (build adımı yoktur).
