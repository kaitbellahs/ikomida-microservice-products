import { Domain, Utils, BackendTypes, Types, Logics, DBModels } from '@ikomida/shared-backend';
import { Buffer } from 'buffer';

export default class Products {
  logger;
  googleAdmin;
  production;

  constructor(logger: Utils.Logger) {
    this.logger = logger;
    this.googleAdmin = new Utils.GoogleAdmin(this.logger);
    this.production = process.env.NODE_ENV === 'production'
  }

  private async uploadToStorage(identity: Types.Classes.CUser, productModel: DBModels.ProductModel, payload?: string) {
    try {
      if (payload?.includes('data:')) {
        const [metadata, base64Image] = payload.split(',');
        const [dataType] = metadata ? metadata.split(';') : [];
        let imageExtension = 'jpg';
        if (dataType === 'data:image/png') {
          imageExtension = 'png';
        }
        const imageUri = `${identity.ikomidaID}/products/${productModel.id}/0.${imageExtension}`;
        const buffer = Buffer.from(base64Image, 'base64');

        return (await this.googleAdmin?.uploadFileToStorage(
          `${!this.production ? 'hmlg.' : ''}cdn.ikomida.com`,
          buffer,
          imageExtension,
          imageUri,
          {
            ikomidaID: identity.ikomidaID,
            type: 'image',
            dir: 'product',
          },
        )) ?? productModel.image;
      }
    } catch (exception: any) {
      new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_UPLOAD_IMAGE, exception).log(this.logger);
    }
    return payload ?? productModel.image
  }

  async newProduct(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.CProduct = Types.Classes.CProduct.fromObject(input);
      console.log('payload?.discountType', payload?.discountType)
      const role = BackendTypes.Roles.valueOf(identity.role);
      if (!role || ![BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF].includes(role) || !payload?.category?.id) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_UNAUTHORIZED);
        return error.logAndReturn(this.logger);
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF],
              },
            },
          },
          { model: DBModels.PlanModel, required: true },
          { model: DBModels.ProductModel, required: false },
          {
            model: DBModels.ProductCategoryModel,
            required: false,
            where: {
              id: payload.category?.id,
            },
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      const productsLimit = contractModel?.plan?.products ?? -1;
      if (productsLimit !== 0 && (contractModel?.products?.length ?? 0) >= productsLimit) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_LIMIT_EXCEEDED, productsLimit);
        return error.logAndReturn(this.logger);
      }
      const categories = contractModel?.productCategories;
      if ((categories?.length ?? 0) !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_INVALID_CATEGORY);
        return error.logAndReturn(this.logger);
      }
      const category = categories?.[0];
      const productModel: DBModels.ProductModel = await contractModel.$create('product', {
        title: payload?.title,
        description: payload?.description,
        serves: Logics.Finances.toFinanceNumber(payload?.serves) ?? 1,
        price: Logics.Finances.toFinanceNumber(payload?.price),
        discountType: payload?.discountType,
        discount: Logics.Finances.toFinanceNumber(payload?.discount),
        weight: Logics.Finances.toFinanceNumber(payload?.weight),
        quantity: payload?.quantity,
        image: !payload.image?.includes('data:') ? payload?.image : undefined
      });
      await category?.$add('products', productModel);
      productModel.image = await this.uploadToStorage(identity, productModel, payload.image)
      await productModel.save();
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async editProduct(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.CProduct = Types.Classes.CProduct.fromObject(input);
      const role = BackendTypes.Roles.valueOf(identity.role);
      const products = Array.isArray(payload) ? payload : [payload];
      for (const product of products) {
        if (role !== BackendTypes.Roles.VENDOR || !product?.id) {
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_UNAUTHORIZED);
          return error.logAndReturn(this.logger);
        }
        const include: Domain.SqlDB.Includeable[] = [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR],
              },
            },
          },
          { model: DBModels.PlanModel, required: true },
          { model: DBModels.ProductModel, required: false },
          {
            model: DBModels.ProductModel,
            required: false,
            where: {
              id: product?.id,
            },
          },
        ];
        if (product?.category?.id) {
          include.push({
            model: DBModels.ProductCategoryModel,
            required: false,
            where: {
              id: product?.category?.id,
            },
          });
        }
        const contractModel = await DBModels.ContractModel.findOne({
          where: {
            ikomidaID: identity.ikomidaID,
          },
          include,
        });
        if (!contractModel) {
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_INVALID_CONTRACT);
          return error.logAndReturn(this.logger);
        }
        const productModels = contractModel?.products;
        if (!productModels || productModels.length !== 1) {
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_INVALID_PRODUCT);
          return error.logAndReturn(this.logger);
        }
        const productModel = productModels?.[0];
        if (product?.category?.id) {
          const categories = contractModel?.productCategories;
          if (categories?.length !== 1) {
            const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_INVALID_CATEGORY);
            return error.logAndReturn(this.logger);
          }
          const category = categories[0];
          await category.$add('product', productModel);
        }
        productModel.order = product?.order ?? productModel.order;
        productModel.title = product?.title ?? productModel.title;
        productModel.description = product?.description ?? productModel.description;
        productModel.serves = Logics.Finances.toFinanceNumber(product?.serves) ?? productModel.serves;
        productModel.price = Logics.Finances.toFinanceNumber(product.price) ?? productModel.price;
        productModel.discountType = product?.discountType ?? productModel.discountType;
        productModel.discount = product?.discount
          ? Logics.Finances.toFinanceNumber(product?.discount) ?? undefined
          : productModel.discount;
        productModel.weight = product?.quantity
          ? Logics.Finances.toFinanceNumber(product.weight) ?? undefined
          : productModel.weight;
        productModel.quantity = Logics.Finances.toFinanceNumber(product?.quantity) ?? productModel.quantity;
        productModel.image = await this.uploadToStorage(identity, productModel, payload.image)
        await productModel.save();
      }
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async newCategory(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.CProductCategory = Types.Classes.CProductCategory.fromObject(input);
      const role = BackendTypes.Roles.valueOf(identity.role);
      if (!role || ![BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF].includes(role)) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_CATEGORY_UNAUTHORIZED);
        return error.logAndReturn(this.logger);
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF],
              },
            },
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_CATEGORY_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      await contractModel.$create('productCategory', {
        title: payload.title,
        description: payload.description,
      });
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async editCategory(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.CProductCategory = Types.Classes.CProductCategory.fromObject(input);
      const role = BackendTypes.Roles.valueOf(identity.role);
      if (role !== BackendTypes.Roles.VENDOR) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_CATEGORY_UNAUTHORIZED);
        return error.logAndReturn(this.logger);
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR],
              },
            },
          },
          {
            model: DBModels.ProductCategoryModel,
            required: false,
            where: {
              id: payload?.id,
            },
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_CATEGORY_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      const productCategoryModels = await contractModel?.productCategories;
      if (!productCategoryModels || (productCategoryModels?.length ?? 0) !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_CATEGORY_INVALID_CATEGORY);
        return error.logAndReturn(this.logger);
      }
      await productCategoryModels[0].update({
        title: payload.title,
        description: payload.description,
      });
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async getProduct(identity: Types.Classes.CUser, id?: string) {
    try {
      if (!Logics.Validations.validateUUID(id)) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCT_MISSING_DATA);
        return error.logAndReturn(this.logger);
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [
                  BackendTypes.Roles.VENDOR,
                  BackendTypes.Roles.STAFF,
                  BackendTypes.Roles.CLIENT,
                  BackendTypes.Roles.ADMIN,
                ],
              },
            },
          },
          { model: DBModels.PlanModel, required: true },
          {
            model: DBModels.ProductModel,
            where: {
              id,
            },
            required: false,
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      if ((contractModel?.products?.length ?? 0) !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCT_NOT_FOUNT);
        return error.logAndReturn(this.logger);
      }
      const productModel = contractModel?.products?.[0];
      const product = Types.Classes.CProduct.init(
        productModel?.title ?? '-',
        productModel?.price ?? 0,
        productModel?.discount ?? 0,
        productModel?.discountType ?? Types.Types.TDiscount.NO,
        productModel?.quantity ?? 0,
        productModel?.description,
        undefined,
        productModel?.serves,
        productModel?.weight,
        undefined,
        productModel?.image,
        productModel?.createdAt,
        productModel?.id,
      );
      return new Utils.Return(true, product);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async getProducts(identity: Types.Classes.CUser) {
    try {
      const role = BackendTypes.Roles.valueOf(identity.role);
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [
                  BackendTypes.Roles.VENDOR,
                  BackendTypes.Roles.STAFF,
                  BackendTypes.Roles.CLIENT,
                  BackendTypes.Roles.ADMIN,
                ],
              },
            },
          },
          { model: DBModels.PlanModel, required: true },
          {
            model: DBModels.ProductCategoryModel,
            required: false,
            include: [
              {
                model: DBModels.ProductModel,
                order: [
                  ['order', 'ASC'],
                  ['title', 'ASC'],
                ],
              },
            ],
            order: [
              ['order', 'ASC'],
              ['title', 'ASC'],
            ],
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      const productsAndCategoriesModels = contractModel?.productCategories;
      const productsAndCategories = await Promise.all(
        productsAndCategoriesModels?.map(async (productsAndCategoryModel, i: number) => {
          productsAndCategoryModel.order = productsAndCategoryModel?.order ?? i;
          await productsAndCategoryModel?.save();
          const productModels = productsAndCategoryModel?.products ?? [];
          const products = await Promise.all(
            productModels.map(async (productModel: DBModels.ProductModel, j: number) => {
              productModel.order = productModel?.order ?? j;
              await productModel?.save();
              const product = Types.Classes.CProduct.init(
                productModel?.title ?? '-',
                productModel?.price ?? 0,
                productModel?.discount ?? 0,
                productModel?.discountType ?? Types.Types.TDiscount.NO,
                productModel?.quantity ?? 0,
                productModel?.description,
                productModel?.order,
                productModel?.serves,
                productModel?.weight,
                undefined,
                productModel?.image,
                productModel?.createdAt,
                productModel?.id,
              );
              if (
                role &&
                [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF, BackendTypes.Roles.ADMIN].includes(role)
              ) {
                product.category = Types.Classes.CProductCategory.init(
                  '',
                  undefined,
                  undefined,
                  productModel?.productCategoryId,
                );
              }
              return product;
            }) || [],
          );
          const productsAndCategory = Types.Classes.CCategoryProducts.init(
            productsAndCategoryModel?.title ?? '-',
            productsAndCategoryModel?.order,
            productsAndCategoryModel?.description,
            productsAndCategoryModel?.createdAt,
            products,
          );
          if (role && [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF, BackendTypes.Roles.ADMIN].includes(role)) {
            productsAndCategory.id = productsAndCategoryModel?.id;
          }
          return productsAndCategory;
        }) || [],
      );
      return new Utils.Return(true, productsAndCategories);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async getProductsCount(identity: Types.Classes.CUser) {
    const role = BackendTypes.Roles.valueOf(identity.role);
    if (!role || ![BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF].includes(role)) {
      return new Utils.Return(true, 0);
    }
    const contractModel = await DBModels.ContractModel.findOne({
      where: {
        ikomidaID: identity.ikomidaID,
      },
      include: [
        {
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF, BackendTypes.Roles.ADMIN],
            },
          },
        },
        { model: DBModels.PlanModel, required: true },
        { model: DBModels.ProductModel, required: false },
      ],
    });
    if (!contractModel) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_COUNT_INVALID_CONTRACT);
      return error.logAndReturn(this.logger);
    }
    const productModels = contractModel?.products;
    return new Utils.Return(true, productModels?.length);
  }

  async getCategories(identity: Types.Classes.CUser) {
    const contractModel = await DBModels.ContractModel.findOne({
      where: {
        ikomidaID: identity.ikomidaID,
      },
      include: [
        {
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF, BackendTypes.Roles.ADMIN],
            },
          },
        },
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductCategoryModel,
          required: false,
          order: [['title', 'ASC']],
        },
      ],
    });
    if (!contractModel) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_CATEGORIES_COUNT_INVALID_CONTRACT);
      return error.logAndReturn(this.logger);
    }
    const categoryModels = await contractModel?.productCategories;
    const categories = categoryModels?.map((categoryModel) => {
      return Types.Classes.CProductCategory.init(
        categoryModel?.title ?? '-',
        undefined,
        categoryModel?.description,
        categoryModel?.id,
      );
    });
    return new Utils.Return(true, categories);
  }

  async deleteProduct(identity: Types.Classes.CUser, id?: string) {
    try {
      if (!Logics.Validations.validateUUID(id)) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_MISSING_DATA);
        return error.logAndReturn(this.logger);
      }
      const role = BackendTypes.Roles.valueOf(identity.role);
      if (role !== BackendTypes.Roles.VENDOR) {
        return new Utils.Return(false);
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR, BackendTypes.Roles.ADMIN],
              },
            },
          },
          { model: DBModels.PlanModel, required: true },
          {
            model: DBModels.ProductModel,
            required: false,
            where: {
              id,
            },
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      const productModels = contractModel?.products;
      if (!productModels || productModels.length !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_NOT_FOUND);
        return error.logAndReturn(this.logger);
      }
      await productModels[0].destroy();
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async deleteCategory(identity: Types.Classes.CUser, id?: string) {
    try {
      if (!Logics.Validations.validateUUID(id)) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORY_MISSING_DATA);
        return error.logAndReturn(this.logger);
      }
      const role = BackendTypes.Roles.valueOf(identity.role);
      if (role !== BackendTypes.Roles.VENDOR) {
        return new Utils.Return(false);
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.VENDOR, BackendTypes.Roles.ADMIN],
              },
            },
          },
          { model: DBModels.PlanModel, required: true },
          {
            model: DBModels.ProductCategoryModel,
            required: false,
            where: {
              id,
            },
            include: [
              {
                model: DBModels.ProductModel,
                required: false,
              },
            ],
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      const categoryModels = contractModel?.productCategories;
      if (!categoryModels || (categoryModels?.length ?? 0) !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_NOT_FOUND);
        return error.logAndReturn(this.logger);
      }
      const categoryModel = categoryModels[0];
      const productModels = (await categoryModel?.products) ?? [];
      for (const productModel of productModels) {
        await productModel.destroy();
      }
      await categoryModel.destroy();
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }
}
