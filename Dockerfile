FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Full source code as a zip (for uploading to GitHub), served at /download/sportkit-hive-source.zip
RUN python -c "import zipfile,pathlib; r=pathlib.Path('/app'); out=r/'static/download/sportkit-hive-source.zip'; out.parent.mkdir(parents=True,exist_ok=True); z=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED); [z.write(p, 'sportkit-hive/'+str(p.relative_to(r))) for p in sorted(r.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p!=out]; z.close()"
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
