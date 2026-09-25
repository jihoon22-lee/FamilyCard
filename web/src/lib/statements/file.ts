import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { fromBuffer } from 'yauzl';
import { InputError } from '@/lib/cards';
export const FILE_LIMIT = 2 * 1024 * 1024,
  ROW_LIMIT = 1000;
async function validateZip(bytes: Buffer) {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) {
        reject(new InputError('XLSX 압축 구조를 읽을 수 없습니다.'));
        return;
      }
      let count = 0,
        total = 0;
      const fail = () => {
        zip.close();
        reject(new InputError('XLSX 압축 해제 크기/구조 한도를 초과했습니다.'));
      };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        if (
          ++count > 200 ||
          entry.uncompressedSize > 10 * 1024 * 1024 ||
          (entry.generalPurposeBitFlag & 1) !== 0
        ) {
          fail();
          return;
        }
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            fail();
            return;
          }
          let entrySize = 0;
          const inspect = /\.(xml|rels)$/.test(entry.fileName);
          const parts: Buffer[] = [];
          stream.on('data', (chunk) => {
            if (inspect) parts.push(Buffer.from(chunk));
            total += chunk.length;
            entrySize += chunk.length;
            if (total > 20 * 1024 * 1024 || entrySize > (inspect ? 2 : 10) * 1024 * 1024) {
              stream.destroy();
              fail();
            }
          });
          stream.on('error', fail);
          stream.on('end', () => {
            if (inspect) {
              const xml = Buffer.concat(parts).toString('utf8');
              const rowTags = [...xml.matchAll(/<(?:[A-Za-z0-9_]+:)?row(?:\s[^>]*|\/?)>/g)];
              const cells = [...xml.matchAll(/<(?:[A-Za-z0-9_]+:)?(?:c|si)(?=[\s/>])/g)].length;
              if (
                xml.includes('\0') ||
                /<!DOCTYPE|<!ENTITY/i.test(xml) ||
                rowTags.length > ROW_LIMIT + 1 ||
                cells > 50050 ||
                rowTags.some((m) => {
                  const n = /\br\s*=\s*["'](\d+)/.exec(m[0]);
                  return n && Number(n[1]) > ROW_LIMIT + 1;
                })
              ) {
                fail();
                return;
              }
            }
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
function cell(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Excel does not distinguish a date-only value from an exact midnight trade.
    // Prefer DAY at midnight; preserve explicitly nonzero time components.
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('T', ' ').slice(0, 19);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if ('formula' in value || 'sharedFormula' in value)
    throw new InputError('수식 셀은 값으로 변환한 뒤 가져와주세요.');
  if ('richText' in value) return value.richText.map((t) => t.text).join('');
  if ('text' in value) return value.text;
  throw new InputError('지원하지 않는 오류 셀이 있습니다.');
}
export async function readStatementFile(fileName: string, bytes: Buffer, encoding = 'utf-8') {
  if (!bytes.length || bytes.length > FILE_LIMIT)
    throw new InputError('명세서는 2MiB 이하 CSV/XLSX 파일로 가져와주세요.');
  let rows: string[][];
  if (fileName.toLowerCase().endsWith('.csv')) {
    if (!['utf-8', 'euc-kr'].includes(encoding)) throw new InputError('CSV 인코딩을 확인해주세요.');
    try {
      rows = parse(new TextDecoder(encoding, { fatal: true }).decode(bytes), {
        bom: true,
        relax_column_count: true,
        skip_empty_lines: true,
        max_record_size: 16000,
        to: ROW_LIMIT + 2,
      }) as string[][];
    } catch {
      throw new InputError('CSV 형식·인코딩 또는 행 길이를 확인해주세요.');
    }
  } else if (fileName.toLowerCase().endsWith('.xlsx')) {
    await validateZip(bytes);
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(bytes as unknown as ExcelJS.Buffer, {
        ignoreNodes: ['drawing', 'picture', 'extLst', 'conditionalFormatting', 'dataValidations'],
      });
    } catch {
      throw new InputError('XLSX 파일을 읽지 못했습니다. 암호화 파일은 지원하지 않습니다.');
    }
    const sheet = book.worksheets[0];
    if (!sheet) throw new InputError('첫 시트에 데이터가 없습니다.');
    if (sheet.rowCount > ROW_LIMIT + 1 || sheet.columnCount > 50)
      throw new InputError('명세서는 첫 시트 1,000행·50열까지 지원합니다.');
    rows = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const values: string[] = [];
      for (let c = 1; c <= sheet.columnCount; c++)
        values.push(cell(sheet.getRow(r).getCell(c).value));
      rows.push(values);
    }
  } else throw new InputError('CSV 또는 XLSX 형식을 선택해주세요.');
  if (
    rows.length < 2 ||
    rows.length > ROW_LIMIT + 1 ||
    rows.some((row) => row.length > 50 || row.some((v) => v.length > 2000))
  )
    throw new InputError(
      '첫 행은 열 이름이어야 하며, 데이터 1~1,000행·50열·셀 2,000자까지 지원합니다.',
    );
  return { headers: rows[0]!, rows: rows.slice(1) };
}
