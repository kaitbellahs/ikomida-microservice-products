import express from 'express'
import bodyParser from 'body-parser'
import Products from './controllers/Products.js'
import { BackendTypes, Types, Utils } from '@ikomida/shared-backend'

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
let { name } = require('../package.json')
name = name
  .replace(/^(@\S+\/)?(svelte-)?(\S+)/, '$3')
  .replace(/^\w/, (m: string) => m.toUpperCase())
  .replace(/-\w/g, (m: string[]) => m[1].toUpperCase())
const logger = Utils.Logger.getInstance(name)
const products = new Products(logger)
const app = express()
app.disable('x-powered-by')
app.use(bodyParser.json({ limit: '10mb' }))
Utils.System.setExpressResponse(app)
const port = process?.env?.PORT || 80

app.get('/products', async (req, res) => {
  const identity: Types.Classes.CUser = req.headers?.identity
    ? Types.Classes.CUser.fromObject(req.headers?.identity)
    : Types.Classes.CUser.fillWith(undefined)
  if (!req.headers?.identity) {
    const ikomidaId = req.headers?.['x-ikomida-id']
    identity.ikomidaID = typeof ikomidaId === 'string' ? ikomidaId : ''
  }
  const payload = await products.getProducts(identity, req.query as Types.Interfaces.IMetadata)
  res.sendResponse(payload)
})

app.get('/lowQuantityProducts', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const payload = await products.getLowQuantityProducts(identity)
  res.sendResponse(payload)
})

app.get('/product/:id', async (req, res) => {
  const identity: Types.Classes.CUser = req.headers?.identity
    ? Types.Classes.CUser.fromObject(req.headers?.identity)
    : Types.Classes.CUser.fillWith(undefined)
  if (!req.headers?.identity) {
    const ikomidaId = req.headers?.['x-ikomida-id']
    identity.ikomidaID = typeof ikomidaId === 'string' ? ikomidaId : ''
  }
  const payload = await products.getProduct(identity, req?.params?.id, req.query as Types.Interfaces.IMetadata)
  res.sendResponse(payload)
})

app.get('/productsCount', async (req, res) => {
  const payload = await products.getProductsCount(Types.Classes.CUser.fromObject(req.headers?.identity))
  res.sendResponse(payload)
})

app.get('/categories', async (req, res) => {
  const payload = await products.getCategories(Types.Classes.CUser.fromObject(req.headers?.identity), req.query as Types.Interfaces.IMetadata)
  res.sendResponse(payload)
})

app.delete('/product/:id', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const role = identity.role
  if (role && [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN].includes(role)) {
    const payload = await products.deleteProduct(identity, req.params.id, req.query as Types.Interfaces.IMetadata)
    res.status(payload?.success ? 201 : 200).sendResponse(payload)
  } else {
    res.status(403)
  }
})

app.patch('/product/:id', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const payload = await products.activateProduct(identity, req.params.id, req.query as Types.Interfaces.IMetadata)
  res.status(payload?.success ? 201 : 200).sendResponse(payload)
})

app.delete('/category/:id', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const role = identity.role
  if (role && [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN].includes(role)) {
    const payload = await products.deleteCategory(identity, req.params.id, req.query as Types.Interfaces.IMetadata)
    res.status(payload?.success ? 201 : 200).sendResponse(payload)
  } else {
    res.status(403)
  }
})

app.delete('/productoption/:id', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const role = identity.role
  if (role && [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN].includes(role)) {
    const payload = await products.deleteProductOption(identity, req.params.id, req.query as Types.Interfaces.IMetadata)
    res.status(payload?.success ? 201 : 200).sendResponse(payload)
  } else {
    res.status(403)
  }
})

app.delete('/productoptionscategory/:id', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const role = identity.role
  if (role && [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN].includes(role)) {
    const payload = await products.deleteCategoryOptions(identity, req.params.id, req.query as Types.Interfaces.IMetadata)
    res.status(payload?.success ? 201 : 200).sendResponse(payload)
  } else {
    res.status(403)
  }
})

app.put('/product', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const role = identity.role
  if (role && [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN].includes(role)) {
    const payload = await products.editProduct(identity, req.body, req.query as Types.Interfaces.IMetadata)
    res.status(payload?.success ? 201 : 200).sendResponse(payload)
  } else {
    res.status(403)
  }
})

app.put('/category', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const role = identity.role
  if (role && [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN].includes(role)) {
    const payload = await products.editCategory(identity, req.body, req.query as Types.Interfaces.IMetadata)
    res.status(payload?.success ? 201 : 200).sendResponse(payload)
  } else {
    res.status(403)
  }
})

app.post('/product', async (req, res) => {
  try {
    const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
    const role = identity.role
    if (role && [Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN].includes(role)) {
      const payload = await products.newProduct(identity, req.body, req.query as Types.Interfaces.IMetadata)
      res.status(payload?.success ? 201 : 200).sendResponse(payload)
    } else {
      res.status(403)
    }
  } catch (exception) {
    logger.error(exception)
  }
})

app.post('/category', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const role = identity.role
  if (role && [Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN].includes(role)) {
    const payload = await products.newCategory(identity, req.body, req.query as Types.Interfaces.IMetadata)
    res.status(payload?.success ? 201 : 200).sendResponse(payload)
  } else {
    res.status(403)
  }
})

app.all('*', async (req, res) => {
  logger.error(`Products endpoint "${req?.url}" not found:`)
  res.status(404).sendResponse({ error: 'NOT FOUND' })
})
// await products.insertProducts()

app.listen(port, () => {
  logger.info(`${name} listening at http://localhost:${port}`)
})
