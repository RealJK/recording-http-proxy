recording-http-proxy
====================

Install Dependencies

<pre>
# npm install commander connect@2.20.2 moment node-fs fs.extra log4js
</pre>


HTTP proxy that saves all the files that it proxied (suffixed with timestamp) into the file system.  Great for debugging on the server-side.  It's like Fiddler for the server - best to capture binary files, or debugging server components.

Example, multiple requests for www.domain.com/crossdomain.xml will result to different files.

<pre>

The output folder looks like:
{client-ip}/
  http /
    www.domain.com /
      crossdomain.xml.2013-04-09T15-04-37-033
      crossdomain.xml.2013-04-09T15-04-46-493

</pre>
