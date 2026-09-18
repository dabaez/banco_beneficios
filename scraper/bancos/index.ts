/** Registro de adaptadores. Agregar un banco = agregarlo aquí y en shared/bancos.ts. */
import type { BancoId } from '../../shared/bancos.ts';
import type { Banco } from '../tipos.ts';
import { bancochile } from './bancochile/index.ts';
import { bancoestado } from './bancoestado/index.ts';
import { bci } from './bci/index.ts';
import { falabella } from './falabella/index.ts';
import { santander } from './santander/index.ts';

export const ADAPTADORES: Record<BancoId, Banco> = { bci, santander, bancoestado, falabella, bancochile };
