# ikomida-microservice-products

Catalog: products, categories, options and stock.

> Part of the **iKomida** platform. See **[ikomida-k8s-config](https://github.com/kaitbellahs/ikomida-k8s-config)** for the architecture overview of all 31 repositories.

---

## Role

Serves the storefront catalog to anonymous visitors and gives vendors full write access to their own. Product options are modelled in two levels (option categories containing options), which is what lets a vendor express "choose one size, then up to three toppings". Also serves product imagery and reports low-stock items.

## Endpoints

As declared in the [gateway route table](https://github.com/kaitbellahs/ikomida-microservice-gateway/blob/dev/src/routes.ts) (16 routes reach this service):

| Method | Path | Roles |
|---|---|---|
| `GET` | `/products` | ALL |
| `GET` | `/product/:id` | ALL |
| `GET` | `/lowQuantityProducts` | VENDOR, STAFF, ADMIN |
| `PATCH` | `/product/:id` | VENDOR, STAFF, ADMIN |
| `GET` | `/productsCount` | VENDOR, STAFF |
| `GET` | `/categories` | CLIENT, VENDOR, STAFF, ADMIN |
| `GET` | `/image/:imageUri` | CLIENT, VENDOR, STAFF |
| `DELETE` | `/product/:id` | VENDOR, ADMIN |
| `DELETE` | `/category/:id` | VENDOR, ADMIN |
| `DELETE` | `/productoption/:id` | VENDOR, STAFF, ADMIN |
| `DELETE` | `/productoptionscategory/:id` | VENDOR, STAFF, ADMIN |
| `PUT` | `/product` | VENDOR, ADMIN |
| `PUT` | `/category` | VENDOR, ADMIN |
| `POST` | `/product` | VENDOR, STAFF, ADMIN |
| `PUT` | `/category` | VENDOR, ADMIN |
| `POST` | `/category` | VENDOR, STAFF, ADMIN |

## Stack

TypeScript (ESM) · Express · Sequelize · rollup · Docker · Kubernetes

Depends on [`@ikomida/shared-types`](https://github.com/kaitbellahs/ikomida-shared-types), [`@ikomida/shared-backend`](https://github.com/kaitbellahs/ikomida-shared-backend) and [`@ikomida/shared-logics`](https://github.com/kaitbellahs/ikomida-shared-logics).

## Build

```bash
yarn install
yarn build      # rollup bundle
yarn service    # run locally
```

## Status

Built in 2022. The platform is no longer deployed; this repository is published as a record of the work. **The commit history predates generative AI coding assistants.**

## License

Licensed under the [Apache License 2.0](LICENSE) — free for commercial use, provided the copyright notice and [NOTICE](NOTICE) are retained.

Copyright 2022 Khalid Ait Bellahs.
