import { Domain, Utils, Types, Logics, DBModels } from '@ikomida/shared-backend'
import { IiKomidaErrorModel } from '@ikomida/shared-backend/lib/src/Utils/iKomidaError.js'
import { v4 as uuidv4 } from 'uuid'

export default class Products {
  logger
  googleAdmin
  production

  IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_OPTIONS_LIMIT: IiKomidaErrorModel = {
    code: 'PPRS014',
    message: `O seu plano não permite adição de mais que {0} option num unico produto!`
  }

  constructor(logger: Utils.Logger) {
    this.logger = logger
    this.googleAdmin = new Utils.GoogleAdmin(this.logger)
    this.production = process.env.NODE_ENV === 'production'
  }

  private countProductOptions(
    productOptionsCategories: Types.Classes.CProductOptionsCategory[],
    producOptionsCategoryModels?: DBModels.ProductOptionsCategoryModel[]
  ) {
    let length = 0
    const producOptionModelIds: (string | undefined)[] =
      producOptionsCategoryModels?.flatMap(producOptionsCategoryModel => {
        const producOptionsModels =
          producOptionsCategoryModel.productOptions?.flatMap(producOption => producOption.id) ?? []
        length += producOptionsModels.length
        return producOptionsModels
      }) ?? []
    const options: Types.Classes.CProductOption[] = []
    for (const productOptionsCategory of productOptionsCategories) {
      options.push(...productOptionsCategory.options)
    }

    const filtredOptions = options.filter(option => !option.id || !producOptionModelIds.includes(option.id))
    length += filtredOptions.length
    return Number(length)
  }

  async newProduct(identity: Types.Classes.CUser, input: any, query?: Types.Interfaces.IMetadata) {
    try {
      console.log('query:', query)
      const payload: Types.Classes.CProduct = Types.Classes.CProduct.fromObject(input)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      const role = identity.role
      if (!role || ![...Types.Types.TRoles.internals, Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF].includes(role) || !payload.category?.id) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_UNAUTHORIZED)
      }
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        { model: DBModels.ProductModel, required: false },
        {
          model: DBModels.ProductCategoryModel,
          required: false,
          where: {
            id: payload.category?.id
          }
        }
      ]
      if (!Types.Types.TRoles.isInternal(identity.role)) {
        include.push({
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF]
            }
          }
        })
      }
      const contractModel = await DBModels.ContractModel.findOne({
        logging: console.log,
        where:
          Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_INVALID_CONTRACT)
      }
      const productsLimit = contractModel?.plan?.products ?? -1
      if (productsLimit !== -1 && (contractModel?.products?.length ?? 0) >= productsLimit) {
        throw new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_LIMIT_EXCEEDED,
          productsLimit
        )
      }
      const optionsCategories = payload.optionsCategories ?? []
      const productOptionsLimit = Number(contractModel.plan?.productOptions ?? -1)
      if (productOptionsLimit !== -1 && this.countProductOptions(optionsCategories) > productOptionsLimit) {
        throw new Utils.iKomidaError(this.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_OPTIONS_LIMIT, productOptionsLimit)
      }
      const categories = contractModel?.productCategories
      if (categories?.length !== 1) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_INVALID_CATEGORY)
      }
      const productId = uuidv4()
      const categoryModel = categories[0]
      const productOptionsCategories = await Promise.all(
        optionsCategories.map(async optionsCategory => {
          const productOptionategoryId = uuidv4()
          const image = await this.googleAdmin.uploadToStorage(
            identity,
            productOptionategoryId,
            'image',
            'productOptionsCategory',
            optionsCategory.image
          )
          const options = await Promise.all(
            optionsCategory.options.map(async item => {
              const productOptionId = uuidv4()
              const image = await this.googleAdmin.uploadToStorage(
                identity,
                productOptionId,
                'image',
                'optionsCategory',
                item.image
              )
              return {
                name: item.name,
                image,
                highlighted: item.highlighted,
                order: item.order,
                price: item.price,
                units: item.units,
                productCategoryId: categoryModel.id,
                contractId: contractModel.id,
                productId
              }
            })
          )
          return {
            name: optionsCategory.name,
            image,
            highlighted: optionsCategory.highlighted,
            min: optionsCategory.min,
            max: optionsCategory.max,
            order: optionsCategory.order,
            productCategoryId: categoryModel.id,
            contractId: contractModel.id,
            productOptions: options,
            productId
          }
        })
      )
      const image = await this.googleAdmin.uploadToStorage(identity, productId, 'image', 'product', payload.image)
      const countProducts = await categoryModel.$count('products')
      const productModel: DBModels.ProductModel = await contractModel.$create(
        'product',
        {
          id: productId,
          title: payload.title,
          description: payload.description,
          serves: Logics.Finances.toFinanceNumber(payload.serves) ?? 1,
          price: Logics.Finances.toFinanceNumber(payload.price),
          discountType: payload.discountType,
          discount: Logics.Finances.toFinanceNumber(payload.discount),
          measure: Logics.Finances.toFinanceNumber(payload.measure),
          measureUnit: payload.measureUnit,
          quantity: payload.quantity,
          maxQuantityPerOrder: payload.maxQuantityPerOrder,
          totalQuantity: payload.quantity,
          image,
          orderTypes: payload.orderTypes,
          productCategoryId: categoryModel.id,
          productOptionsCategories,
          order: countProducts
        },
        {
          include: [
            {
              model: DBModels.ProductOptionsCategoryModel,
              include: [DBModels.ProductOptionModel]
            }
          ]
        }
      )
      return new Utils.Return(productModel !== null)
    } catch (exception: any) {
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async editProduct(identity: Types.Classes.CUser, input: any, query?: Types.Interfaces.IMetadata) {
    const transaction = await Domain.SqlDB.sequelize.transaction({ autocommit: false })
    try {
      console.log('query:', query)
      const payload: Types.Classes.CProduct | Types.Classes.CProduct[] = Types.Classes.CProduct.fromObject(input)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      const products = Array.isArray(payload) ? payload : [payload]
      for (const product of products) {
        if (!product?.id) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_UNAUTHORIZED)
        }
        const include: Domain.SqlDB.Includeable[] = [
          { model: DBModels.PlanModel, required: true },
          { model: DBModels.PlanModel, required: true },
          {
            model: DBModels.ProductModel,
            required: false,
            where: {
              id: product?.id
            },
            include: [
              {
                model: DBModels.ProductOptionsCategoryModel,
                required: false,
                include: [{ model: DBModels.ProductOptionModel, required: false }]
              }
            ]
          }
        ]
        if (product?.category?.id) {
          include.push({
            model: DBModels.ProductCategoryModel,
            required: false,
            where: {
              id: product?.category?.id
            }
          })
        }
        if (!Types.Types.TRoles.isInternal(identity.role)) {
          include.push(
            {
              model: DBModels.UserModel,
              required: true,
              where: {
                id: identity.id,
                role: {
                  [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR]
                }
              }
            })
        }
        const contractModel = await DBModels.ContractModel.findOne({
          logging: console.log,
          where:
            Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
              ? {
                id: query?.contractId
              }
              : {
                ikomidaID: identity?.ikomidaID
              },
          include
        })
        if (!contractModel) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_INVALID_CONTRACT)
        }
        const productModels = contractModel?.products
        if (!productModels || productModels.length !== 1) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_INVALID_PRODUCT)
        }
        const productModel = productModels?.[0]
        const optionsCategories = product.optionsCategories ?? []
        const productOptionsLimit = Number(contractModel.plan?.productOptions ?? -1)
        if (
          productOptionsLimit !== -1 &&
          this.countProductOptions(optionsCategories, productModel.productOptionsCategories) > productOptionsLimit
        ) {
          throw new Utils.iKomidaError(this.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_OPTIONS_LIMIT, productOptionsLimit)
        }
        let productCategoryModel = contractModel.productCategories?.[0]
        if (product?.category?.id) {
          const categories = contractModel?.productCategories
          if (categories?.length !== 1) {
            throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_PRODUCT_INVALID_CATEGORY)
          }
          productCategoryModel = categories[0]
          productModel.productCategoryId = productCategoryModel.id
        }
        productModel.order = product?.order ?? productModel.order
        productModel.title = product?.title ?? productModel.title
        productModel.description = product?.description ?? productModel.description
        productModel.serves = Logics.Finances.toFinanceNumber(product?.serves) ?? productModel.serves
        productModel.price = Logics.Finances.toFinanceNumber(product.price) ?? productModel.price
        productModel.discountType = product?.discountType ?? productModel.discountType
        productModel.orderTypes = product?.orderTypes ?? productModel.orderTypes
        productModel.discount = product?.discount
          ? Logics.Finances.toFinanceNumber(product?.discount) ?? undefined
          : productModel.discount
        productModel.measure = product?.measure
          ? Logics.Finances.toFinanceNumber(product.measure) ?? undefined
          : productModel.measure
        productModel.measureUnit = product?.measureUnit ?? productModel.measureUnit
        productModel.quantity = Logics.Finances.toFinanceNumber(product?.quantity) ?? productModel.quantity
        productModel.totalQuantity =
          (productModel.totalQuantity ?? 0) +
          ((Logics.Finances.toFinanceNumber(product?.quantity) ?? 0) - (productModel.quantity ?? 0))
        productModel.maxQuantityPerOrder =
          Logics.Finances.toFinanceNumber(product?.maxQuantityPerOrder) ?? productModel.maxQuantityPerOrder
        productModel.image = await this.googleAdmin.uploadToStorage(
          identity,
          product.id,
          'image',
          'product',
          product.image,
          productModel.image
        )
        const producOptionsCategoryModelIds: (string | undefined)[] =
          productModel.productOptionsCategories?.flatMap(producOptionsCategoryModel => producOptionsCategoryModel.id) ??
          []
        for (const optionsCategory of optionsCategories) {
          let productOptionsCategoryModel = productModel.productOptionsCategories?.filter(
            productOptionsCategory => productOptionsCategory.id === optionsCategory.id
          )[0]
          const uuid = productOptionsCategoryModel?.id ?? uuidv4()
          const image = await this.googleAdmin.uploadToStorage(
            identity,
            uuid,
            'image',
            'productOptionsCategory',
            optionsCategory.image,
            productOptionsCategoryModel?.image
          )
          if (!producOptionsCategoryModelIds.includes(optionsCategory.id)) {
            productOptionsCategoryModel = await productModel.$create(
              'productOptionsCategory',
              {
                id: uuid,
                name: optionsCategory.name,
                image,
                highlighted: optionsCategory.highlighted,
                min: optionsCategory.min,
                max: optionsCategory.max,
                order: optionsCategory.order,
                contract: contractModel
              },
              { transaction }
            )
          } else {
            if (productOptionsCategoryModel) {
              productOptionsCategoryModel.image = image
              productOptionsCategoryModel.name = optionsCategory.name
              productOptionsCategoryModel.highlighted = optionsCategory.highlighted
              productOptionsCategoryModel.min = optionsCategory.min
              productOptionsCategoryModel.max = optionsCategory.max
              productOptionsCategoryModel.order = optionsCategory.order
              await productOptionsCategoryModel.save({ transaction })
            } else {
              throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION)
            }
          }
          const options = optionsCategory.options
          if (productOptionsCategoryModel && options && options.length > 0) {
            const producOptionModelIds: (string | undefined)[] =
              productOptionsCategoryModel.productOptions?.flatMap(producOptionModel => producOptionModel.id) ?? []
            const newOptions = options
              .filter(option => !producOptionModelIds.includes(option.id))
              .filter(option => {
                return !option.id
              })
            const newOptionModels = await Promise.all(
              newOptions.map(async option => {
                const uuid = uuidv4()
                const image = await this.googleAdmin.uploadToStorage(
                  identity,
                  uuid,
                  'image',
                  'optionsCategory',
                  option.image
                )
                return Object.assign(option, {
                  contractId: contractModel.id,
                  productOptionsCategoryId: productOptionsCategoryModel?.id,
                  productId: productModel.id,
                  productCategoryId: productCategoryModel?.id,
                  image
                })
              }) as []
            )
            if (newOptionModels.length > 0) {
              await DBModels.ProductOptionModel.bulkCreate(newOptionModels, { transaction })
            }
            const oldOptions = options
              .filter(option => producOptionModelIds.includes(option.id))
              .filter(option => {
                return option.id
              })
            for (const oldOption of oldOptions) {
              const productOptionModel = productOptionsCategoryModel?.productOptions?.filter(
                productOptionModel => productOptionModel.id === oldOption.id
              )?.[0]
              if (productOptionModel && productOptionModel?.id) {
                const image = await this.googleAdmin.uploadToStorage(
                  identity,
                  productOptionModel.id,
                  'image',
                  'optionsCategory',
                  oldOption.image,
                  productOptionModel.image
                )
                productOptionModel.name = oldOption.name
                productOptionModel.image = image
                productOptionModel.highlighted = oldOption.highlighted
                productOptionModel.order = oldOption.order
                productOptionModel.price = oldOption.price
                productOptionModel.units = oldOption.units
                await productOptionModel.save({ transaction })
              } else {
                throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION)
              }
            }
          }
        }
        await productModel.save({ transaction })
      }
      await transaction.commit()
      return new Utils.Return(true)
    } catch (exception: any) {
      await transaction.rollback()
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async newCategory(identity: Types.Classes.CUser, input: any, query?: Types.Interfaces.IMetadata) {
    const transaction = await Domain.SqlDB.sequelize.transaction()
    try {
      console.log('query:', query)
      const payload: Types.Classes.CProductCategory = Types.Classes.CProductCategory.fromObject(input)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      const role = identity.role
      if (!role || ![Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN].includes(role)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_CATEGORY_UNAUTHORIZED)
      }
      const include: Domain.SqlDB.Includeable[] = [
      ]
      if (!Types.Types.TRoles.isInternal(identity.role)) {
        include.push(
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF]
              }
            }
          }
        )
      }

      const contractModel = await DBModels.ContractModel.findOne({
        logging: console.log,
        where:
          Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_CATEGORY_INVALID_CONTRACT)
      }
      const countCategories = await contractModel.$count('productCategories')
      await contractModel.$create('productCategory', {
        title: payload.title,
        description: payload.description,
        businessHours: payload.business?.hours,
        businessDays: payload.business?.days,
        order: countCategories
      })
      await transaction.commit()
      return new Utils.Return(true)
    } catch (exception: any) {
      await transaction.rollback()
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async editCategory(identity: Types.Classes.CUser, input: any, query?: Types.Interfaces.IMetadata) {
    const transaction = await Domain.SqlDB.sequelize.transaction({ autocommit: false })
    try {
      const payload: Types.Classes.CCategoryProducts | Types.Classes.CCategoryProducts[] =
        Types.Classes.CCategoryProducts.fromObject(input)
      console.log('payload:', payload)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      const role = identity.role
      if (!role || ![Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN].includes(role)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_CATEGORY_UNAUTHORIZED)
      }
      const categories = Array.isArray(payload) ? payload : [payload]
      for (const category of categories) {
        if (!category.id) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_CATEGORY_UNAUTHORIZED)
        }
        const include: Domain.SqlDB.Includeable[] = [
          {
            model: DBModels.ProductCategoryModel,
            required: false,
            where: {
              id: category.id
            }
          }
        ]
        if (!Types.Types.TRoles.isInternal(identity.role)) {
          include.push(
            {
              model: DBModels.UserModel,
              required: true,
              where: {
                id: identity.id,
                role: {
                  [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR]
                }
              }
            }
          )
        }
        console.log('include:', include)
        const contractModel = await DBModels.ContractModel.findOne({
          logging: console.log,
          where:
            Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
              ? {
                id: query?.contractId
              }
              : {
                ikomidaID: identity?.ikomidaID
              },
          include
        })
        if (!contractModel) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_CATEGORY_INVALID_CONTRACT)
        }
        const productCategoryModels = contractModel?.productCategories
        if (!productCategoryModels || (productCategoryModels?.length ?? 0) !== 1) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_EDIT_CATEGORY_INVALID_CATEGORY)
        }
        const productCategoryModel = productCategoryModels[0]
        await productCategoryModel.update(
          {
            title: category.title ?? productCategoryModel.title,
            description: category.description,
            order: category.order ?? productCategoryModel.order,
            businessHours: category.business?.hours,
            businessDays: category.business?.days
          },
          {
            transaction
          }
        )
      }
      await transaction.commit()
      return new Utils.Return(true)
    } catch (exception: any) {
      await transaction.rollback()
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async getProduct(identity?: Types.Classes.CUser, id?: string, query?: Types.Interfaces.IMetadata) {
    try {
      console.log('query:', query)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      if (!Logics.Validations.validateUUID(id)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCT_MISSING_DATA)
      }
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductModel,
          where: {
            id
          },
          required: false,
          include: [
            {
              model: DBModels.ProductCategoryModel,
              required: false
            },
            {
              model: DBModels.ProductOptionsCategoryModel,
              required: false,
              include: [
                {
                  model: DBModels.ProductOptionModel,
                  required: false
                }
              ]
            }
          ]
        }
      ]
      if (identity?.role && !Types.Types.TRoles.isInternal(identity.role)) {
        include.push({
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity?.id,
            role: {
              [Domain.SqlDB.Op.in]: [
                Types.Types.TRoles.VENDOR,
                Types.Types.TRoles.STAFF,
                Types.Types.TRoles.CLIENT,
                Types.Types.TRoles.ADMIN
              ]
            }
          }
        })
      }
      const contractModel = await DBModels.ContractModel.findOne({
        logging: console.log,
        where:
          identity?.role && Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      if (contractModel.products?.length !== 1) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCT_NOT_FOUNT)
      }
      const productModel = contractModel.products?.[0]
      if (!productModel?.productCategory) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCT_NOT_FOUNT)
      }
      const productOptionsCategories = productModel?.productOptionsCategories?.map(productOptionsCategory => {
        const options =
          productOptionsCategory.productOptions?.map(productOption =>
            Types.Classes.CProductOption.init(
              productOption.name ?? '',
              productOption.highlighted ?? false,
              productOption.price ?? 0,
              productOption.units ?? 0,
              productOption.order ?? 0,
              productOption.image,
              productOption.id
            )
          ) ?? []
        return Types.Classes.CProductOptionsCategory.init(
          productOptionsCategory.name ?? '',
          productOptionsCategory.highlighted ?? false,
          productOptionsCategory.min ?? 0,
          productOptionsCategory.max ?? 0,
          productOptionsCategory.order ?? 0,
          options,
          productOptionsCategory.image,
          productOptionsCategory.id
        )
      })
      const productCategory = Types.Classes.CProductCategory.init(
        productModel?.productCategory.title ?? '',
        undefined,
        undefined,
        undefined,
        productModel?.productCategory.id
      )
      const product = Types.Classes.CProduct.init(
        productModel?.title ?? '-',
        productModel?.price ?? 0,
        productModel?.discount ?? 0,
        productModel?.discountType ?? Types.Types.TDiscount.NO,
        productModel?.quantity ?? 0,
        productModel?.description,
        productModel?.order,
        productModel?.serves,
        productModel?.measure,
        productModel?.measureUnit,
        productCategory,
        productModel?.image,
        productOptionsCategories,
        undefined,
        productModel?.createdAt,
        undefined,
        productModel?.active,
        productModel?.orderTypes,
        productModel.totalQuantity,
        productModel.maxQuantityPerOrder,
        productModel?.id
      )
      return new Utils.Return(true, product)
    } catch (exception: any) {
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async getProducts(identity?: Types.Classes.CUser, query?: Types.Interfaces.IMetadata) {
    try {
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      let where = {}
      const orderType = Types.Types.TOrderType.valueOf(query?.orderType ?? '')
      if (orderType) {
        where = Domain.SqlDB.fn(
          'JSON_CONTAINS',
          Domain.SqlDB.Column('orderTypes'),
          Domain.SqlDB.cast(`"${orderType.id}"`, 'CHAR CHARACTER SET utf8')
        )
      }
      const role = identity?.role
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductCategoryModel,
          required: role === Types.Types.TRoles.CLIENT,
          include: [
            {
              model: DBModels.ProductModel,
              required: false,
              where,
              include: [
                {
                  model: DBModels.ProductOptionsCategoryModel,
                  required: false,
                  include: [
                    {
                      model: DBModels.ProductOptionModel,
                      required: false
                    }
                  ]
                }
              ],
              order: [
                ['order', 'ASC'],
                ['title', 'ASC']
              ]
            }
          ],
          order: [
            ['order', 'ASC'],
            ['title', 'ASC']
          ]
        }
      ]
      if (identity?.id && !Utils.System.isDemo(identity.ikomidaID, identity.areaCode, identity.phone) && !Types.Types.TRoles.isInternal(identity.role)) {
        include.push({
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [
                Types.Types.TRoles.VENDOR,
                Types.Types.TRoles.STAFF,
                Types.Types.TRoles.CLIENT,
                Types.Types.TRoles.ADMIN
              ]
            }
          }
        })
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where:
          identity?.role && Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      const categoriesOrder: number[] = []
      const productsAndCategoriesModels = contractModel?.productCategories
      const productsAndCategories = await Promise.all(
        productsAndCategoriesModels?.map(async (productsAndCategoryModel, i: number) => {
          let categoryOrder = productsAndCategoryModel?.order ?? i
          if (categoryOrder < 0) {
            categoryOrder = 0
          }
          if (categoriesOrder.includes(categoryOrder)) {
            categoryOrder += Math.max(...categoriesOrder)
          }
          categoriesOrder.push(categoryOrder)
          productsAndCategoryModel.order = categoryOrder
          await productsAndCategoryModel?.save()
          const productsOrder: number[] = []
          const productModels = productsAndCategoryModel?.products ?? []
          const products = await Promise.all(
            productModels.map(async (productModel: DBModels.ProductModel, j: number) => {
              let productOrder = productModel?.order ?? j
              if (productOrder < 0) {
                productOrder = 0
              }
              if (productsOrder.includes(productOrder)) {
                productOrder = Math.max(...productsOrder) + 1
              }
              productsOrder.push(productOrder)
              productModel.order = productOrder
              await productModel?.save()
              const productOptionsCategories = productModel?.productOptionsCategories?.map(productOptionsCategory => {
                const options =
                  productOptionsCategory.productOptions?.map(productOption =>
                    Types.Classes.CProductOption.init(
                      productOption.name ?? '',
                      productOption.highlighted ?? false,
                      productOption.price ?? 0,
                      productOption.units ?? 0,
                      productOption.order ?? 0,
                      productOption.image,
                      productOption.id
                    )
                  ) ?? []
                return Types.Classes.CProductOptionsCategory.init(
                  productOptionsCategory.name ?? '',
                  productOptionsCategory.highlighted ?? false,
                  productOptionsCategory.min ?? 0,
                  productOptionsCategory.max ?? 0,
                  productOptionsCategory.order ?? 0,
                  options,
                  productOptionsCategory.image,
                  productOptionsCategory.id
                )
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
                productModel.measure,
                productModel.measureUnit,
                undefined,
                productModel.image,
                productOptionsCategories,
                undefined,
                productModel.createdAt,
                undefined,
                productModel.active,
                productModel.orderTypes,
                undefined,
                productModel.maxQuantityPerOrder,
                productModel.id
              )
              if (role && (Types.Types.TRoles.isVendor(role) || Types.Types.TRoles.isInternal(role))) {
                product.totalQuantity = productModel.totalQuantity
                product.category = Types.Classes.CProductCategory.init(
                  '',
                  undefined,
                  undefined,
                  undefined,
                  productModel.productCategoryId
                )
              }
              return product
            }) || []
          )
          const productsAndCategory = Types.Classes.CCategoryProducts.init(
            productsAndCategoryModel.title ?? '-',
            productsAndCategoryModel.order,
            productsAndCategoryModel.description,
            productsAndCategoryModel.createdAt,
            products,
            Types.Classes.CBusinessTime.fromObject({
              hours: productsAndCategoryModel.businessHours,
              days: productsAndCategoryModel.businessDays
            })
          )
          if (role && (Types.Types.TRoles.isVendor(role) || Types.Types.TRoles.isInternal(role))) {
            productsAndCategory.id = productsAndCategoryModel?.id
          }
          return productsAndCategory
        }) || []
      )
      return new Utils.Return(true, productsAndCategories)
    } catch (exception: any) {
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async getLowQuantityProducts(identity?: Types.Classes.CUser) {
    try {
      if (!identity?.ikomidaID) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      const role = identity?.role
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductModel,
          required: false,
          where: {
            quantity: {
              [Domain.SqlDB.Op.lte]: 10
            }
          },
          order: [
            ['quantity', 'ASC'],
            ['order', 'ASC'],
            ['title', 'ASC']
          ]
        },
        {
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [
                Types.Types.TRoles.VENDOR,
                Types.Types.TRoles.STAFF,
                Types.Types.TRoles.CLIENT,
                Types.Types.TRoles.ADMIN
              ]
            }
          }
        }
      ]
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity?.ikomidaID
        },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      const productModels = contractModel?.products ?? []
      const products =
        (await Promise.all(
          productModels.map(async (productModel: DBModels.ProductModel) => {
            const product = Types.Classes.CProduct.init(
              productModel.title ?? '-',
              productModel.price ?? 0,
              productModel.discount ?? 0,
              productModel.discountType ?? Types.Types.TDiscount.NO,
              productModel.quantity ?? 0,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              productModel.image,
              undefined,
              undefined,
              productModel.createdAt,
              undefined,
              undefined,
              productModel.orderTypes,
              productModel.totalQuantity,
              undefined,
              productModel.id
            )
            if (role && Types.Types.TRoles.isVendor(role)) {
              product.category = Types.Classes.CProductCategory.init(
                '',
                undefined,
                undefined,
                undefined,
                productModel.productCategoryId
              )
            }
            return product
          }) || []
        )) || []
      return new Utils.Return(true, products)
    } catch (exception: any) {
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async getProductsCount(identity: Types.Classes.CUser) {
    try {
      const role = identity.role
      if (!role || ![Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF].includes(role)) {
        return new Utils.Return(true, 0)
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN]
              }
            }
          },
          { model: DBModels.PlanModel, required: true },
          { model: DBModels.ProductModel, required: false }
        ]
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_COUNT_INVALID_CONTRACT)
      }
      const productModels = contractModel?.products
      return new Utils.Return(true, productModels?.length)
    } catch (exception: any) {
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async getCategories(identity: Types.Classes.CUser, query?: Types.Interfaces.IMetadata) {
    try {
      console.log('query:', query)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductCategoryModel,
          required: false,
          order: [['title', 'ASC']]
        }
      ]
      if (identity?.role && !Types.Types.TRoles.isInternal(identity.role)) {
        include.push(
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN]
              }
            }
          })
      }
      const contractModel = await DBModels.ContractModel.findOne({
        logging: console.log,
        where:
          Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_CATEGORIES_COUNT_INVALID_CONTRACT)
      }
      const categoryModels = contractModel?.productCategories
      const categories = categoryModels?.map(categoryModel => {
        return Types.Classes.CProductCategory.init(
          categoryModel?.title ?? '-',
          undefined,
          categoryModel?.description,
          Types.Classes.CBusinessTime.fromObject({
            hours: categoryModel.businessHours,
            days: categoryModel.businessDays
          }),
          categoryModel?.id
        )
      })
      return new Utils.Return(true, categories)
    } catch (exception: any) {
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async deleteProduct(identity: Types.Classes.CUser, id?: string, query?: Types.Interfaces.IMetadata) {
    const transaction = await Domain.SqlDB.sequelize.transaction()
    try {
      console.log('query:', query)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      if (!Logics.Validations.validateUUID(id)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_MISSING_DATA)
      }
      const role = identity.role
      if (!role || ![Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN].includes(role)) {
        return new Utils.Return(false)
      }
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductModel,
          required: false,
          where: {
            id
          }
        }
      ]
      if (identity?.role && !Types.Types.TRoles.isInternal(identity.role)) {
        include.push(
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN]
              }
            }
          })
      }
      const contractModel = await DBModels.ContractModel.findOne({
        logging: console.log,
        where:
          Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_INVALID_CONTRACT)
      }
      const productModels = contractModel?.products
      if (!productModels || productModels.length !== 1) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_NOT_FOUND)
      }
      const productModel = productModels[0]
      await DBModels.ProductOptionModel.destroy({
        transaction,
        where: {
          contractId: contractModel.id,
          productId: productModel.id
        }
      })
      await DBModels.ProductOptionsCategoryModel.destroy({
        transaction,
        where: {
          contractId: contractModel.id,
          productId: productModel.id
        }
      })
      await productModel.destroy({ transaction })
      await transaction.commit()
      return new Utils.Return(true)
    } catch (exception: any) {
      await transaction.rollback()
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async deleteCategory(identity: Types.Classes.CUser, id?: string, query?: Types.Interfaces.IMetadata) {
    const transaction = await Domain.SqlDB.sequelize.transaction()
    try {
      console.log('query:', query)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      if (!Logics.Validations.validateUUID(id)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORY_MISSING_DATA)
      }
      const role = identity.role
      if (!role || ![Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN].includes(role)) {
        return new Utils.Return(false)
      }
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductCategoryModel,
          required: false,
          where: {
            id
          },
          include: [
            {
              model: DBModels.ProductModel,
              required: false
            }
          ]
        }
      ]
      if (identity?.role && !Types.Types.TRoles.isInternal(identity.role)) {
        include.push(
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN]
              }
            }
          })
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where:
          Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_INVALID_CONTRACT)
      }
      const categoryModels = contractModel?.productCategories
      if (categoryModels?.length !== 1) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_NOT_FOUND)
      }
      const categoryModel = categoryModels[0]
      const productsIds = categoryModel.products?.map(product => product.id) ?? []
      await DBModels.ProductOptionModel.destroy({
        transaction,
        where: {
          contractId: contractModel.id,
          productCategoryId: categoryModel.id,
          productId: {
            [Domain.SqlDB.Op.in]: productsIds
          }
        }
      })
      await DBModels.ProductOptionsCategoryModel.destroy({
        transaction,
        where: {
          contractId: contractModel.id,
          productCategoryId: categoryModel.id,
          productId: {
            [Domain.SqlDB.Op.in]: productsIds
          }
        }
      })
      await DBModels.ProductModel.destroy({
        transaction,
        where: {
          contractId: contractModel.id,
          productCategoryId: categoryModel.id,
          id: {
            [Domain.SqlDB.Op.in]: productsIds
          }
        }
      })
      await categoryModel.destroy({ transaction })
      await transaction.commit()
      return new Utils.Return(true)
    } catch (exception: any) {
      await transaction.rollback()
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async deleteProductOption(identity: Types.Classes.CUser, id?: string, query?: Types.Interfaces.IMetadata) {
    const transaction = await Domain.SqlDB.sequelize.transaction()
    try {
      console.log('query:', query)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      if (!Logics.Validations.validateUUID(id)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_MISSING_DATA)
      }
      const role = identity.role
      if (!role || ![Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN].includes(role)) {
        return new Utils.Return(false)
      }
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductOptionModel,
          required: false,
          where: {
            id
          }
        }
      ]
      if (identity?.role && !Types.Types.TRoles.isInternal(identity.role)) {
        include.push(
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN]
              }
            }
          })
      }
      const contractModel = await DBModels.ContractModel.findOne({
        logging: console.log,
        where:
          Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_INVALID_CONTRACT)
      }
      const productOptionModels = contractModel?.productOptions
      if (!productOptionModels || productOptionModels.length !== 1) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_NOT_FOUND)
      }
      const productOptionModel = productOptionModels[0]
      await productOptionModel.destroy({ transaction })
      await transaction.commit()
      return new Utils.Return(true)
    } catch (exception: any) {
      await transaction.rollback()
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async deleteCategoryOptions(identity: Types.Classes.CUser, id?: string, query?: Types.Interfaces.IMetadata) {
    const transaction = await Domain.SqlDB.sequelize.transaction()
    try {
      console.log('query:', query)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      if (!Logics.Validations.validateUUID(id)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORY_MISSING_DATA)
      }
      const role = identity.role
      if (!role || ![Types.Types.TRoles.VENDOR, Types.Types.TRoles.STAFF, Types.Types.TRoles.ADMIN].includes(role)) {
        return new Utils.Return(false)
      }
      const include: Domain.SqlDB.Includeable[] = [
        { model: DBModels.PlanModel, required: true },
        {
          model: DBModels.ProductOptionsCategoryModel,
          required: false,
          where: {
            id
          }
        }
      ]
      if (identity?.role && !Types.Types.TRoles.isInternal(identity.role)) {
        include.push(
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [Types.Types.TRoles.VENDOR, Types.Types.TRoles.ADMIN]
              }
            }
          })
      }
      const contractModel = await DBModels.ContractModel.findOne({
        logging: console.log,
        where:
          Types.Types.TRoles.isInternal(identity.role) && Logics.Validations.validateUUID(query?.contractId)
            ? {
              id: query?.contractId
            }
            : {
              ikomidaID: identity?.ikomidaID
            },
        include
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_INVALID_CONTRACT)
      }
      const productOptionsCategoryModels = contractModel?.productOptionsCategories
      if (productOptionsCategoryModels?.length !== 1) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_CATEGORIES_NOT_FOUND)
      }
      const productOptionsCategoryModel = productOptionsCategoryModels[0]
      await DBModels.ProductOptionModel.destroy({
        transaction,
        where: {
          contractId: contractModel.id,
          productOptionsCategoryId: productOptionsCategoryModel.id
        }
      })
      await productOptionsCategoryModel.destroy({ transaction })
      await transaction.commit()
      return new Utils.Return(true)
    } catch (exception: any) {
      await transaction.rollback()
      let error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_NEW_PRODUCT_EXCEPTION, exception)
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      }
      return error.logAndReturn(this.logger)
    }
  }

  async activateProduct(identity: Types.Classes.CUser, id?: string, query?: Types.Interfaces.IMetadata) {
    try {
      console.log('query:', query)
      if (!identity?.ikomidaID && !Logics.Validations.validateUUID(query?.contractId)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_GET_PRODUCTS_INVALID_CONTRACT)
      }
      if (!Logics.Validations.validateUUID(id)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_PRODUCTS_SERVICE_DELETE_PRODUCT_MISSING_DATA)
      }
      const roductModel = await DBModels.ProductModel.findOne({
        where: {
          id
        }
      })
      if (roductModel) {
        roductModel.active = !roductModel?.active
        roductModel?.save()
        return new Utils.Return(true)
      }
      return new Utils.Return(false)
    } catch (exception: any) {
      const error = new Utils.iKomidaError(
        Utils.iKomidaError.IKOMIDA_ADMIN_SERVICE_ACTIVE_SETTING_EXCEPTION,
        exception?.message
      )
      return error.logAndReturn(this.logger)
    }
  }
}
