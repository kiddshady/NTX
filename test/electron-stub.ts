/**
 * Lo poco de `electron` que tocan los módulos del main que prueba el test.
 * El test corre en Electron como Node: ahí `require('electron')` no trae la API.
 */
import { resolve } from 'node:path'

export const app = {
  isPackaged: false,
  getAppPath: (): string => resolve(import.meta.dirname, '..'),
  getPath: (): string => process.env.NTX_TEST_USERDATA ?? resolve(import.meta.dirname, '..', '.test-data'),
  getVersion: (): string => 'test'
}
