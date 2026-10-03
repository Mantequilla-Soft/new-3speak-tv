import { Helmet } from 'react-helmet-async';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

const SEOHead = ({
  title = null,
  description = null,
  image = 'https://3speak.tv/3speak.jpeg',
  url = 'https://3speak.tv/',
  type = 'website',
  author = null,
  video = null,
  publishedTime = null,
  modifiedTime = null,
  structuredData = null,
}) => {
  // "3S" matches the logo and leads, so the platform is the part that survives a
  // narrow tab. The brand default passes through untouched rather than being
  // branded twice.
  const { t } = useTranslation();
  const fullTitle = title ? `3S | ${title}` : t('misc.seo.defaultTitle');
  const desc = description || t('misc.seo.defaultDescription');

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={desc} />
      <link rel="canonical" href={url} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:site_name" content="3Speak" />

      {publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}

      {modifiedTime && (
        <meta property="article:modified_time" content={modifiedTime} />
      )}

      {author && (
        <meta property="article:author" content={author} />
      )}

      {/* Twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={url} />
      <meta property="twitter:title" content={fullTitle} />
      <meta property="twitter:description" content={desc} />
      <meta property="twitter:image" content={image} />
      <meta name="twitter:site" content="@3speaktv" />
      <meta name="twitter:creator" content="@3speaktv" />

      {/* Video specific meta tags */}
      {video && (
        <>
          <meta property="og:video" content={video.url} />
          <meta property="og:video:secure_url" content={video.url} />
          <meta property="og:video:type" content="video/mp4" />
          {video.width && <meta property="og:video:width" content={video.width} />}
          {video.height && <meta property="og:video:height" content={video.height} />}
          {video.duration && <meta property="video:duration" content={video.duration} />}
        </>
      )}

      {/* JSON-LD Structured Data */}
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      )}
    </Helmet>
  );
};

SEOHead.propTypes = {
  title: PropTypes.string,
  description: PropTypes.string,
  image: PropTypes.string,
  url: PropTypes.string,
  type: PropTypes.string,
  author: PropTypes.string,
  video: PropTypes.shape({
    url: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    duration: PropTypes.number,
  }),
  publishedTime: PropTypes.string,
  modifiedTime: PropTypes.string,
  structuredData: PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.arrayOf(PropTypes.object),
  ]),
};

export default SEOHead;
