recording-http-proxy
====================

Based on NodeJS, this proxy will do as what it says.  Proxy HTTP requests between the proxy and the servers
that it wish to talks to.

Also, it will save each of the responses into the output directory (suffixed by the timestamp).  Therefore,
multiple requests for www.domain.com/crossdomain.xml will result to different files.  This is good for
troubleshooting binary files (for text, just use fiddler/firebug, etc).

The output folder looks like:
{client-ip}/
  http /
    www.domain.com /
      crossdomain.xml.2013-04-09T15-04-37-033
      crossdomain.xml.2013-04-09T15-04-46-493

*At this point, HTTPS is not supported.
