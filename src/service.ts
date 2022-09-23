import express from 'express';
import bodyParser from 'body-parser';
import Products from './controllers/Products.js';
import { BackendTypes, Types, Utils } from '@ikomida/shared-backend';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let { name } = require('../package.json');
name = name
  .replace(/^(@\S+\/)?(svelte-)?(\S+)/, '$3')
  .replace(/^\w/, (m: string) => m.toUpperCase())
  .replace(/-\w/g, (m: string[]) => m[1].toUpperCase());
const logger = Utils.Logger.getInstance(name);
const products = new Products(logger);
const app = express();
app.disable('x-powered-by');
app.use(bodyParser.json({ limit: '10mb' }));
Utils.System.setExpressResponse(app);
const port = process?.env?.PORT || 80;

app.get('/products', async (req, res) => {
  const payload = await products.getProducts(Types.Classes.CUser.fromObject(req.headers?.identity));
  res.sendResponse(payload);
});

app.get('/product/:id', async (req, res) => {
  const payload = await products.getProduct(Types.Classes.CUser.fromObject(req.headers?.identity), req?.params?.id);
  res.sendResponse(payload);
});

app.get('/productsCount', async (req, res) => {
  const payload = await products.getProductsCount(Types.Classes.CUser.fromObject(req.headers?.identity));
  res.sendResponse(payload);
});

app.get('/categories', async (req, res) => {
  const payload = await products.getCategories(Types.Classes.CUser.fromObject(req.headers?.identity));
  res.sendResponse(payload);
});

app.delete('/product/:id', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity);
  const role = BackendTypes.Roles.valueOf(identity.role);
  if (role === BackendTypes.Roles.VENDOR) {
    const payload = await products.deleteProduct(identity, req.params.id);
    res.status(payload?.success ? 201 : 200).sendResponse(payload);
  } else {
    res.status(403);
  }
});

app.delete('/category/:id', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity);
  const role = BackendTypes.Roles.valueOf(identity.role);
  if (role === BackendTypes.Roles.VENDOR) {
    const payload = await products.deleteCategory(identity, req.params.id);
    res.status(payload?.success ? 201 : 200).sendResponse(payload);
  } else {
    res.status(403);
  }
});

app.put('/product', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity);
  const role = BackendTypes.Roles.valueOf(identity.role);
  if (role === BackendTypes.Roles.VENDOR) {
    const payload = await products.editProduct(identity, req.body);
    res.status(payload?.success ? 201 : 200).sendResponse(payload);
  } else {
    res.status(403);
  }
});

app.put('/category', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity);
  const role = BackendTypes.Roles.valueOf(identity.role);
  if (role === BackendTypes.Roles.VENDOR) {
    const payload = await products.editCategory(identity, req.body);
    res.status(payload?.success ? 201 : 200).sendResponse(payload);
  } else {
    res.status(403);
  }
});

app.post('/product', async (req, res) => {
  try {
    const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity);
    const role = BackendTypes.Roles.valueOf(identity.role);
    if (role && [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF].includes(role)) {
      const payload = await products.newProduct(identity, req.body);
      res.status(payload?.success ? 201 : 200).sendResponse(payload);
    } else {
      res.status(403);
    }
  } catch (exception) {
    console.error(exception)
  }
});

app.post('/category', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity);
  const role = BackendTypes.Roles.valueOf(identity.role);
  if (role && [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF].includes(role)) {
    const payload = await products.newCategory(identity, req.body);
    res.status(payload?.success ? 201 : 200).sendResponse(payload);
  } else {
    res.status(403);
  }
});

app.all('*', async (req, res) => {
  logger.error(`Products endpoint "${req?.url}" not found:`);
  res.status(404).sendResponse({ error: 'NOT FOUND' });
});
// await products.insertProducts()

app.listen(port, () => {
  logger.info(`${name} listening at http://localhost:${port}`);
});
