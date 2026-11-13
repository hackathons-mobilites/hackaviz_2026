"""Aggregate the four official IDFM 2025 daily workbooks, without editing them.

Usage: python3 scripts/import-idfm-traffic.py /path/to/data-rf-2025.zip
Download URL is recorded in the generated JSON. Only Python's standard library
is needed; worksheets are streamed because they contain millions of records.
"""
import hashlib
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
SOURCE = 'https://data.iledefrance-mobilites.fr/explore/dataset/histo-validations-reseau-ferre/'
DOWNLOAD = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/histo-validations-reseau-ferre/files/f23d8b3b613b51008b8419a33a47e0cf'


def sheet_rows(content):
    with zipfile.ZipFile(io.BytesIO(content)) as workbook:
        strings = [''.join(n.itertext()) for n in ET.fromstring(workbook.read('xl/sharedStrings.xml'))]
        with workbook.open('xl/worksheets/sheet1.xml') as sheet:
            parser = ET.iterparse(sheet, events=('start', 'end'))
            _, root = next(parser)
            for event, row in parser:
                if event != 'end' or row.tag != NS + 'row':
                    continue
                values = {}
                for cell in row:
                    value = cell.find(NS + 'v')
                    raw = value.text if value is not None else ''
                    values[re.sub(r'\d', '', cell.attrib['r'])] = strings[int(raw)] if cell.get('t') == 's' else raw
                yield values
                row.clear()
                root.clear()


def aggregate(archive):
    groups = defaultdict(lambda: {'freq': 0, 'lower': 0, 'masked': 0, 'days': set(), 'names': set(), 'quarters': set()})
    sources = []
    with zipfile.ZipFile(archive) as bundle:
        files = sorted(n for n in bundle.namelist() if re.search(r'2025_T[1-4]_NB_FER\.xlsx$', n))
        if len(files) != 4:
            raise ValueError('Expected one daily workbook for each of the four quarters')
        for name in files:
            quarter = int(re.search(r'_T([1-4])_', name)[1])
            content = bundle.read(name)
            rows = sheet_rows(content)
            header = next(rows)
            columns = {v.upper(): k for k, v in header.items()}
            columns['JOUR'] = columns.get('JOUR') or columns['DATE']
            id_col = columns.get('ID_ZDC') or columns['ID_REFA_LDA']
            seen = set()
            dates = set()
            count = total = masked = repeated_keys = 0
            for row in rows:
                if not row.get(columns['JOUR']):
                    continue
                raw_day = row[columns['JOUR']]
                day = datetime.strptime(raw_day, '%d/%m/%Y').date() if '/' in raw_day else date(1899, 12, 30) + timedelta(days=int(float(raw_day)))
                if day.year != 2025 or (day.month - 1) // 3 + 1 != quarter:
                    raise ValueError('Date outside source quarter: ' + str(day))
                key = (str(day), row.get(id_col, ''), row.get(columns['LIBELLE_ARRET'], ''), *(row.get(columns[c], '') for c in ['CODE_STIF_TRNS', 'CODE_STIF_RES', 'CODE_STIF_ARRET', 'CATEGORIE_TITRE']))
                # Some official rows share a key but report different counts
                # (e.g. Porte de Clichy in Q4). Each published row is counted
                # once; no undocumented deduplication or name merge is applied.
                repeated_keys += key in seen
                seen.add(key)
                raw = row[columns['NB_VALD']].strip()
                if raw.isdigit():
                    value = int(raw)
                    lower = 0 if value <= 5 else value
                elif raw.lower() == 'moins de 5':
                    value, lower = 4, 0
                else:
                    raise ValueError('Unknown validation value: ' + raw)
                station_id = row.get(id_col, '').strip()
                group = groups[station_id]
                group['freq'] += value
                group['lower'] += lower
                group['masked'] += value <= 5
                group['days'].add(str(day))
                group['names'].add(row[columns['LIBELLE_ARRET']].strip())
                group['quarters'].add(quarter)
                count += 1
                total += value
                masked += value <= 5
                dates.add(str(day))
            expected_days = (date(2026, 1, 1) if quarter == 4 else date(2025, quarter * 3 + 1, 1)) - date(2025, (quarter - 1) * 3 + 1, 1)
            assert len(dates) == expected_days.days
            sources.append({'file': name, 'sha256': hashlib.sha256(content).hexdigest(), 'rows': count, 'days': len(dates), 'first': min(dates), 'last': max(dates), 'publishedTotal': total, 'maskedRows': masked, 'repeatedKeyRows': repeated_keys})
            print(name, count, 'rows,', len(dates), 'days', flush=True)
    rows = [{'id': key, 'nom': ' / '.join(sorted(g['names'])), 'freq': g['freq'], 'lower': g['lower'], 'maskedRows': g['masked'], 'days': len(g['days']), 'quarters': sorted(g['quarters'])} for key, g in groups.items() if key and key != '0']
    assert len({r['id'] for r in rows}) == len(rows)
    return {'source': 'Île-de-France Mobilités, validations sur le réseau ferré, 2025', 'url': SOURCE, 'download': DOWNLOAD, 'retrieved': date.today().isoformat(), 'archiveSha256': hashlib.file_digest(open(archive, 'rb'), 'sha256').hexdigest(), 'license': 'ODbL', 'notes': 'Somme des quatre trimestres par identifiant ID_ZdC, tous jours et titres. Les valeurs publiées à 5 ou moins sont des valeurs masquées : le total publié forme une borne haute, lower une borne basse prudente. Une validation ne représente ni une personne distincte ni un trajet à pied.', 'files': sources, 'rows': sorted(rows, key=lambda r: -r['freq'])}


if __name__ == '__main__':
    result = aggregate(Path(sys.argv[1]))
    output = Path(__file__).resolve().parents[1] / 'public/data/idfm-validations-2025.json'
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(len(result['rows']), 'station identifiers written to', output)
