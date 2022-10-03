import { Domain, Utils, BackendTypes, Types, Logics, DBModels } from '@ikomida/shared-backend';
import { IiKomidaErrorModel } from '@ikomida/shared-backend/lib/Utils/iKomidaError';
import { v4 as uuidv4 } from 'uuid';


export default class Products {
  logger;
  googleAdmin;
  production;

  IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_OPTIONS_LIMIT: IiKomidaErrorModel = {
    code: 'PPRS014',
    message: `O seu plano não permite adição de mais que {0} option num unico produto!`,
  };

  constructor(logger: Utils.Logger) {
    this.logger = logger;
    this.googleAdmin = new Utils.GoogleAdmin(this.logger);
    this.production = process.env.NODE_ENV === 'production'
  }

  private countProductOptions(productOptionCategories: Types.Classes.CProductOptionCategory[]) {
    let length = 0;
    for (const productOptionCategory of productOptionCategories) {
      length += productOptionCategory.options.length
    }
    return length;
  }

  async newProduct(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.CProduct = Types.Classes.CProduct.fromObject(input);
      const role = BackendTypes.Roles.valueOf(identity.role);
      if (!role || ![BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF].includes(role) || !payload.category?.id) {
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
      const optionsCategories = payload.optionsCategories ?? []
      const productOptionsLimit = contractModel.plan?.productOptions ?? -1;
      if (this.countProductOptions(optionsCategories) > productOptionsLimit) {
        const error = new Utils.iKomidaError(this.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_OPTIONS_LIMIT, productOptionsLimit);
        return error.logAndReturn(this.logger);
      }
      const categories = contractModel?.productCategories;
      if ((categories?.length ?? 0) !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_INVALID_CATEGORY);
        return error.logAndReturn(this.logger);
      }
      const productOptionsCategory: Types.Classes.CProductOptionCategory[] = await Promise.all(optionsCategories.map(async optionsCategory => {
        const productOptionategoryId = uuidv4()
        const image = await this.googleAdmin.uploadToStorage(identity, productOptionategoryId, 'image', 'productOptionsCategory', optionsCategory.image)
        const options: Types.Classes.CProductOption[] = await Promise.all(optionsCategory.options.map(async item => {
          const productOptionId = uuidv4()
          const image = await this.googleAdmin.uploadToStorage(identity, productOptionId, 'image', 'optionsCategory', item.image)
          return Types.Classes.CProductOption.init(item.name, item.highlighted, item.price, item.units, item.order, image, productOptionId)
        })
        )
        return Types.Classes.CProductOptionCategory.init(
          optionsCategory.name,
          optionsCategory.highlighted,
          optionsCategory.min,
          optionsCategory.max,
          optionsCategory.order,
          options,
          image,
          productOptionategoryId
        )
      })
      )
      const id = uuidv4()
      const image = await this.googleAdmin.uploadToStorage(identity, id, 'image', 'product', payload.image)
      const productModel: DBModels.ProductModel = await contractModel.$create('product', {
        id: id,
        title: payload.title,
        description: payload.description,
        serves: Logics.Finances.toFinanceNumber(payload.serves) ?? 1,
        price: Logics.Finances.toFinanceNumber(payload.price),
        discountType: payload.discountType,
        discount: Logics.Finances.toFinanceNumber(payload.discount),
        weight: Logics.Finances.toFinanceNumber(payload.weight),
        quantity: payload.quantity,
        image,
        productCategory: categories?.[0],
        productOptionsCategory
      },
        {
          include: [{
            include: [{
              model: DBModels.ProductCategoryModel
            },
            {
              model: DBModels.ProductOptionCategoryModel,
              include: [DBModels.ProductOptionModel]
            }]
          }]
        });
      return new Utils.Return(productModel !== null);
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
          { model: DBModels.PlanModel, required: true },
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
        const optionsCategories = payload.optionsCategories ?? []
        const productOptionsLimit = contractModel?.plan?.productOptions ?? -1;
        if (this.countProductOptions(optionsCategories) > productOptionsLimit) {
          const error = new Utils.iKomidaError(this.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_OPTIONS_LIMIT, productOptionsLimit);
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
        productModel.image = await this.googleAdmin.uploadToStorage(identity, product.id, 'image', 'product', payload.image, productModel.image)
        await productModel.save();
        const filtredOptionsCategories = optionsCategories.map(optionsCategory => {
          optionsCategory.options = optionsCategory.options.filter(option => !option.id)
          return optionsCategory
        }).filter(optionsCategory => {
          return optionsCategory.options.length > 0 || !optionsCategory.id
        })
        if (filtredOptionsCategories.length > 0) {
          for (const optionsCategory of filtredOptionsCategories) {
            let productOptionsCategory: DBModels.ProductOptionCategoryModel | null
            if (!optionsCategory.id) {
              const uuid = uuidv4()
              const image = await this.googleAdmin.uploadToStorage(identity, uuid, 'image', 'productOptionsCategory', optionsCategory.image)
              productOptionsCategory = await productModel.$create('productOptionsCategory', {
                id: uuid,
                name: optionsCategory.name,
                image,
                highlighted: optionsCategory.highlighted,
                min: optionsCategory.min,
                max: optionsCategory.max,
                order: optionsCategory.order,
                contract: contractModel
              })
            } else {
              productOptionsCategory = (await productModel.$get('productOptionCategories', {
                where: {
                  id: optionsCategory.id
                }
              }))?.[0]
            }
            if (optionsCategory.options && optionsCategory.options.length > 0) {
              const options = await Promise.all(optionsCategory.options.map(async item => {
                const uuid = uuidv4()
                const image = await this.googleAdmin.uploadToStorage(identity, uuid, 'image', 'optionsCategory', item.image)
                return Object.assign(item, {
                  contract: contractModel,
                  productOptionsCategory,
                  image
                })
              }) as []
              )
              await DBModels.ProductOptionModel.bulkCreate(options)
            }
          }
        }
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
              id: payload.id,
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
            include: [
              {
                model: DBModels.ProductOptionCategoryModel,
                required: false,
                include: [
                  {
                    model: DBModels.ProductOptionModel,
                    required: false,
                  }
                ],
              }
            ],
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      if ((contractModel.products?.length ?? 0) !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCT_NOT_FOUNT);
        return error.logAndReturn(this.logger);
      }
      const productModel = contractModel.products?.[0];
      const productOptionCategories = productModel?.productOptionCategories?.map(productOptionCategory => {
        const options = productOptionCategory.productOptions?.map(productOption => Types.Classes.CProductOption.init(productOption.name ?? '', productOption.highlighted ?? false, productOption.price ?? 0, productOption.units ?? 0, productOption.order ?? 0, productOption.image)) ?? []
        return Types.Classes.CProductOptionCategory.init(productOptionCategory.name ?? '', productOptionCategory.highlighted ?? false, productOptionCategory.min ?? 0, productOptionCategory.max ?? 0, productOptionCategory.order ?? 0, options, productOptionCategory.image, productOptionCategory.id)
      })
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
        productOptionCategories,
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
                include: [
                  {
                    model: DBModels.ProductOptionCategoryModel,
                    required: false,
                    include: [
                      {
                        model: DBModels.ProductOptionModel,
                        required: false,
                      }
                    ],
                  }
                ],
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

              const productOptionCategories = productModel?.productOptionCategories?.map(productOptionCategory => {
                const options = productOptionCategory.productOptions?.map(productOption => Types.Classes.CProductOption.init(productOption.name ?? '', productOption.highlighted ?? false, productOption.price ?? 0, productOption.units ?? 0, productOption.order ?? 0, productOption.image)) ?? []
                return Types.Classes.CProductOptionCategory.init(productOptionCategory.name ?? '', productOptionCategory.highlighted ?? false, productOptionCategory.min ?? 0, productOptionCategory.max ?? 0, productOptionCategory.order ?? 0, options, productOptionCategory.image, productOptionCategory.id)
              })
              const product = Types.Classes.CProduct.init(
                productModel.title ?? '-',
                productModel.price ?? 0,
                productModel.discount ?? 0,
                productModel.discountType ?? Types.Types.TDiscount.NO,
                productModel.quantity ?? 0,
                productModel.description,
                productModel.order,
                productModel.serves,
                productModel.weight,
                undefined,
                productModel.image,
                productOptionCategories,
                productModel.createdAt,
                productModel.id,
              );
              if (
                role &&
                [BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF, BackendTypes.Roles.ADMIN].includes(role)
              ) {
                product.category = Types.Classes.CProductCategory.init(
                  '',
                  undefined,
                  undefined,
                  productModel.productCategoryId,
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
      const productModel = productModels[0]
      await DBModels.ProductOptionModel.destroy({
        where: {
          contractId: contractModel.id,
          productId: productModel.id
        }
      })
      await DBModels.ProductOptionCategoryModel.destroy({
        where: {
          contractId: contractModel.id,
          productId: productModel.id
        }
      })
      await productModel.destroy();
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
      if (categoryModels?.length !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_NOT_FOUND);
        return error.logAndReturn(this.logger);
      }
      const categoryModel = categoryModels[0];
      const productsIds = categoryModel.products?.map(product => product.id) ?? []
      await DBModels.ProductOptionModel.destroy({
        where: {
          contractId: contractModel.id,
          productCategoryId: categoryModel.id,
          productId: {
            [Domain.SqlDB.Op.in]: productsIds
          }
        }
      })
      await DBModels.ProductOptionCategoryModel.destroy({
        where: {
          contractId: contractModel.id,
          productCategoryId: categoryModel.id,
          productId: {
            [Domain.SqlDB.Op.in]: productsIds
          }
        }
      })
      await DBModels.ProductModel.destroy({
        where: {
          contractId: contractModel.id,
          productCategoryId: categoryModel.id,
          id: {
            [Domain.SqlDB.Op.in]: productsIds
          }
        }
      })
      await categoryModel.destroy();
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async deleteProductOption(identity: Types.Classes.CUser, id?: string) {
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
            model: DBModels.ProductOptionModel,
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
      const productOptionModels = contractModel?.productOptions;
      if (!productOptionModels || productOptionModels.length !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_NOT_FOUND);
        return error.logAndReturn(this.logger);
      }
      const productOptionModel = productOptionModels[0]
      await productOptionModel.destroy();
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }

  async deleteCategoryOptions(identity: Types.Classes.CUser, id?: string) {
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
            model: DBModels.ProductOptionCategoryModel,
            required: false,
            where: {
              id,
            },
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      const productOptionCategoryModels = contractModel?.productOptionCategories;
      if (productOptionCategoryModels?.length !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_NOT_FOUND);
        return error.logAndReturn(this.logger);
      }
      const productOptionCategoryModel = productOptionCategoryModels[0];
      await DBModels.ProductOptionModel.destroy({
        where: {
          contractId: contractModel.id,
          productOptionCategoryId: productOptionCategoryModel.id,
        }
      })
      await productOptionCategoryModel.destroy();
      return new Utils.Return(true);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception);
      return error.logAndReturn(this.logger);
    }
  }
}
