// Los tipos viven en /shared para compartirlos con el scraper.
export type * from '../../shared/beneficio';
export { BANCOS, IDS_BANCOS, esBancoId, nombreBanco } from '../../shared/bancos';
export type { Banco, BancoId } from '../../shared/bancos';
