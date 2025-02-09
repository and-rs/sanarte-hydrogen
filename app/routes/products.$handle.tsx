import { useLoaderData, type MetaFunction } from "@remix-run/react";
import {
  Analytics,
  getAdjacentAndFirstAvailableVariants,
  getProductOptions,
  getSelectedProductOptions,
  useOptimisticVariant,
  useSelectedOptionInUrlParam,
} from "@shopify/hydrogen";
import { defer, type LoaderFunctionArgs } from "@shopify/remix-oxygen";
import { ProductForm } from "~/components/product/ProductForm";
import { ProductImage } from "~/components/product/ProductImage";
import { ProductPrice } from "~/components/product/ProductPrice";
import { RecommendedProducts } from "~/components/RecommendedProducts";
import { RECOMMENDED_PRODUCTS_QUERY } from "./_index";
import { Separator } from "~/components/ui/separator";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: `SanArte | ${data?.product.title ?? ""}` },
    {
      rel: "canonical",
      href: `/products/${data?.product.handle}`,
    },
  ];
};

export async function loader(args: LoaderFunctionArgs) {
  const deferredData = loadDeferredData(args);
  const criticalData = await loadCriticalData(args);
  return defer({ ...deferredData, ...criticalData });
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 */
async function loadCriticalData({
  context,
  params,
  request,
}: LoaderFunctionArgs) {
  const { handle } = params;
  const { storefront } = context;

  if (!handle) {
    throw new Error("Expected product handle to be defined");
  }

  const [{ product, shop }] = await Promise.all([
    storefront.query(PRODUCT_QUERY, {
      variables: {
        handle,
        selectedOptions: getSelectedProductOptions(request),
      },
    }),
  ]);

  if (!product?.id) {
    throw new Response(null, { status: 404 });
  }

  return {
    product,
    storeDomain: shop.primaryDomain.url,
  };
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 */
function loadDeferredData({ context }: LoaderFunctionArgs) {
  const recommendedProducts = context.storefront
    .query(RECOMMENDED_PRODUCTS_QUERY)
    .catch((error) => {
      console.error(error);
      return null;
    });

  return {
    recommendedProducts,
  };
}

export default function Product() {
  const { product, recommendedProducts, storeDomain } =
    useLoaderData<typeof loader>();

  // Optimistically selects a variant with given available variant information
  const selectedVariant = useOptimisticVariant(
    product.selectedOrFirstAvailableVariant,
    getAdjacentAndFirstAvailableVariants(product),
  );

  // Sets the search param to the selected variant without navigation
  // only when no search params are set in the url
  useSelectedOptionInUrlParam(selectedVariant.selectedOptions);

  // Get the product options array
  const productOptions = getProductOptions({
    ...product,
    selectedOrFirstAvailableVariant: selectedVariant,
  });

  const { title, descriptionHtml } = product;

  return (
    <>
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4 p-4 sm:flex-row md:gap-8 md:p-8">
        <ProductImage images={product?.images.edges} />

        <div className="basis-2/5 space-y-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
            <ProductPrice
              price={selectedVariant?.price}
              className="text-xl font-light"
              compareAtPrice={selectedVariant?.compareAtPrice}
            />
          </div>
          <ProductForm
            storeDomain={storeDomain}
            productOptions={productOptions}
            selectedVariant={selectedVariant}
          />
          <div>
            <h2 className="font-medium">Descripción</h2>
            <div dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
          </div>
        </div>

        <Analytics.ProductView
          data={{
            products: [
              {
                id: product.id,
                title: product.title,
                price: selectedVariant?.price.amount || "0",
                vendor: product.vendor,
                variantId: selectedVariant?.id || "",
                variantTitle: selectedVariant?.title || "",
                quantity: 1,
              },
            ],
          }}
        />
      </div>
      <div className="mx-auto w-full max-w-screen-xl px-8">
        <Separator />
      </div>
      <div className="mx-auto max-w-screen-xl pb-4">
        <RecommendedProducts products={recommendedProducts} />
      </div>
    </>
  );
}

const PRODUCT_VARIANT_FRAGMENT = `#graphql
  fragment ProductVariant on ProductVariant {
    availableForSale
    compareAtPrice {
      amount
      currencyCode
    }
    id
    image {
      __typename
      id
      url
      altText
      width
      height
    }
    price {
      amount
      currencyCode
    }
    product {
      title
      handle
      totalInventory
    }
    selectedOptions {
      name
      value
    }
    quantityAvailable
    sku
    title
    unitPrice {
      amount
      currencyCode
    }
  }
` as const;

const PRODUCT_FRAGMENT = `#graphql
  fragment Product on Product {
    id
    title
    images(first: 5) {
      edges {
        node {
          id
          altText
          height
          width
          url
        }
      }
    }
    vendor
    handle
    description
    descriptionHtml
    encodedVariantExistence
    encodedVariantAvailability
    options {
      name
      optionValues {
        name
        firstSelectableVariant {
          ...ProductVariant
        }
        swatch {
          color
          image {
            previewImage {
              url
            }
          }
        }
      }
    }
    selectedOrFirstAvailableVariant(selectedOptions: $selectedOptions, ignoreUnknownOptions: true, caseInsensitiveMatch: true) {
      ...ProductVariant
    }
    adjacentVariants (selectedOptions: $selectedOptions) {
      ...ProductVariant
    }
    seo {
      description
      title
    }
  }
  ${PRODUCT_VARIANT_FRAGMENT}
` as const;

const PRODUCT_QUERY = `#graphql
  query Product(
    $country: CountryCode
    $handle: String!
    $language: LanguageCode
    $selectedOptions: [SelectedOptionInput!]!
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      ...Product
    }
    shop {
      name
      primaryDomain {
        url
      }
    }
  }
  ${PRODUCT_FRAGMENT}
` as const;
