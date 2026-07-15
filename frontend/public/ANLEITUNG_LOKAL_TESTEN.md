# RailBack-Frontend lokal testen

In diesem Ordner befindet sich die fertig gebaute Version des Frontends. Eine
Installation mit `npm` ist zum Testen dieser Dateien nicht erforderlich.

## Voraussetzungen

- Python 3 ist installiert.
- Die abgegebenen Dateien wurden vollständig entpackt.

## Anwendung starten

1. Ein Terminal öffnen.
2. Im Terminal in den Ordner wechseln, in dem sich die Datei `index.html`
   befindet.
3. Dort folgenden Befehl ausführen:

   ```bash
   python3 -m http.server 8000
   ```

4. Anschließend im Browser diese Adresse öffnen:

   <http://localhost:8000>

Die Anwendung läuft, solange der Befehl im Terminal aktiv ist.

## Anwendung beenden

Im Terminal `Strg+C` drücken.

## Falls Port 8000 bereits verwendet wird

Einen anderen Port auswählen, zum Beispiel:

```bash
python3 -m http.server 8080
```

Die Anwendung ist dann unter <http://localhost:8080> erreichbar.
