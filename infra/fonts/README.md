# Preview fonts

Place deployment-authorized `.ttf` or `.otf` files in this directory on the
server. The files themselves are intentionally ignored by Git and mounted
read-only into the `ocr-rag` container at `/usr/local/share/fonts/dms`.

The container rebuilds its fontconfig cache whenever it starts. After adding
or replacing fonts, recreate `ocr-rag` and verify them with:

```bash
docker compose up -d --force-recreate ocr-rag
docker compose exec ocr-rag fc-match Arial
docker compose exec ocr-rag fc-match Calibri
docker compose exec ocr-rag fc-match Poppins
```

Microsoft font files must only be deployed when the organization has the
appropriate license. Poppins is available from the official Google Fonts
repository under the SIL Open Font License.
