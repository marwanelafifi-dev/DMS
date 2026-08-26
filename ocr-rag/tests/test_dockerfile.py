import unittest
from pathlib import Path


class PreviewContainerDependencyTests(unittest.TestCase):
    def test_installs_spreadsheet_preview_support(self) -> None:
        dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile"
        contents = dockerfile.read_text(encoding="utf-8")
        install_command = contents.split(
            "apt-get install -y --no-install-recommends", maxsplit=1
        )[1].split("&& rm -rf /var/lib/apt/lists/*", maxsplit=1)[0]

        self.assertIn(
            "libreoffice-calc",
            install_command,
            "The preview image must include LibreOffice Calc for .xls/.xlsx files.",
        )


if __name__ == "__main__":
    unittest.main()
