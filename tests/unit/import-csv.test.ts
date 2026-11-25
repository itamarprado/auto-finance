import { expect, it } from 'vitest'
import { csvCell, parseImportCsv } from '../../src/server/ledger/import-csv.ts'

it('interpreta CSV brasileiro, aspas, datas, centavos e identificadores externos', () => {
  const result = parseImportCsv('Data;Descrição;Valor;id_externo;tags\n29/02/2024;"Mercado; ""bairro""";-1.234,50;externo-1;casa|Casa\n2024-02-30;Inválida;5,00;externo-2;', 'account')
  expect(result.rows[0]).toMatchObject({
    line: 2, occurredOn: '2024-02-29', amountCents: 123450, kind: 'expense', description: 'Mercado; "bairro"', tags: ['Casa'],
  })
  expect(result.rows[1]).toMatchObject({ line: 3, issue: expect.stringContaining('Data inválida') })
  expect(JSON.stringify(result)).not.toContain('externo-1')
})

it('aceita CSV por vírgula, oculta identificadores em texto e neutraliza fórmulas ao exportar', () => {
  const result = parseImportCsv('data,descricao,valor\n2024-02-29,"Teste 000.000.000-00",25.50', 'card')
  expect(result.rows[0]).toMatchObject({ kind: 'purchase', amountCents: 2550, description: 'Teste [dado ocultado]' })
  expect(csvCell('  =1+1')).toBe('"\'  =1+1"')
  expect(csvCell('Mercado "A"')).toBe('"Mercado ""A"""')
})

it('recusa arquivo malformado ou grande e mantém registros iguais sem ID externo', () => {
  const duplicate = '2024-02-01;Mesmo movimento;-10,00'
  expect(parseImportCsv(`data;descricao;valor\n${duplicate}\n${duplicate}`, 'account').rows).toHaveLength(2)
  expect(() => parseImportCsv(`data;descricao;valor\n${Array(501).fill(duplicate).join('\n')}`, 'account')).toThrow('500')
  expect(() => parseImportCsv('data;descricao;valor\n2024-02-01;"Aspa aberta;3', 'account')).toThrow('malformado')
})
