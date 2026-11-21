import os
import uuid
from werkzeug.utils import secure_filename
from flask import current_app
import cloudinary.uploader

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def _upload_to_cloudinary(file, folder, public_id=None, **options):
    """Helper to upload to Cloudinary"""
    try:
        current_app.logger.info(f"☁️ Uploading to Cloudinary: folder={folder}")
        upload_result = cloudinary.uploader.upload(
            file,
            folder=folder,
            public_id=public_id,
            resource_type="auto",
            **options
        )
        return upload_result.get('secure_url')
    except Exception as e:
        current_app.logger.error(f"❌ Cloudinary Upload Failed: {e}")
        raise ValueError(f"Cloudinary upload failed: {str(e)}")

def save_uploaded_file(file, branch_id, customer_id):
    """
    Save uploaded file (Customer Image).
    If Cloudinary is configured, uploads there and returns URL.
    Otherwise, saves locally.
    """
    if not file or not file.filename:
        raise ValueError("No file provided")
    
    if not allowed_file(file.filename):
        raise ValueError(f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}")
    
    # 1. Cloudinary Path provided env is set
    if current_app.config.get('CLOUDINARY_CLOUD_NAME'):
        folder = f"customers/{branch_id}/{customer_id}"
        return _upload_to_cloudinary(file, folder)

    # 2. Local Fallback
    extension = file.filename.rsplit('.', 1)[1].lower()
    
    # Create directory structure: uploads/customers/{branch_id}/{customer_id}/
    upload_root = os.environ.get('UPLOAD_FOLDER')
    if upload_root:
        base_dir = os.path.join(upload_root, 'customers', str(branch_id), str(customer_id))
    else:
        # Fallback to local 'uploads' directory
        base_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            'uploads',
            'customers',
            str(branch_id),
            str(customer_id)
        )
    
    # Create directories if they don't exist
    os.makedirs(base_dir, exist_ok=True)
    
    # Count existing images to generate sequential filename
    existing_images = [f for f in os.listdir(base_dir) if f.startswith('image_')]
    image_number = len(existing_images) + 1
    
    # Generate filename: image_1.jpg, image_2.jpg, etc.
    filename = f"image_{image_number}.{extension}"
    filepath = os.path.join(base_dir, filename)
    
    # Save file
    file.save(filepath)
    
    # Return relative path for database storage
    relative_path = os.path.join('customers', str(branch_id), str(customer_id), filename)
    return relative_path

def save_employee_image(file, employee_id):
    """
    Save employee profile image.
    If Cloudinary is configured, uploads there and returns URL.
    """
    if not file or not file.filename:
        raise ValueError("No file provided")
    
    if not allowed_file(file.filename):
        raise ValueError(f"File type not allowed.")
    
    # 1. Cloudinary
    if current_app.config.get('CLOUDINARY_CLOUD_NAME'):
        folder = f"employees/{employee_id}"
        # Use UUID for unique filename
        public_id = f"profile_{uuid.uuid4().hex[:8]}"
        return _upload_to_cloudinary(file, folder, public_id)
    
    # 2. Local Fallback
    extension = file.filename.rsplit('.', 1)[1].lower()
    
    # Path: uploads/employees/{id}/
    upload_root = os.environ.get('UPLOAD_FOLDER')
    if upload_root:
        base_dir = os.path.join(upload_root, 'employees', str(employee_id))
    else:
        base_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            'uploads',
            'employees',
            str(employee_id)
        )
    
    os.makedirs(base_dir, exist_ok=True)
    
    filename = f"profile_{uuid.uuid4().hex[:8]}.{extension}"
    filepath = os.path.join(base_dir, filename)
    
    file.save(filepath)
    
    return os.path.join('employees', str(employee_id), filename)

def save_employee_document(file, employee_id, doc_type):
    """
    Save employee document file (PDF or Image).
    If Cloudinary is configured, uploads there and returns URL.
    """
    if not file or not file.filename:
        raise ValueError("No file provided")
    
    ALLOWED_DOCS = {'png', 'jpg', 'jpeg', 'pdf'}
    if '.' not in file.filename:
         raise ValueError("Invalid file")
         
    extension = file.filename.rsplit('.', 1)[1].lower()
    
    if extension not in ALLOWED_DOCS:
        raise ValueError(f"File type not allowed used: {extension}")
    
    # 1. Cloudinary
    if current_app.config.get('CLOUDINARY_CLOUD_NAME'):
        folder = f"employees/{employee_id}/documents"
        safe_type = secure_filename(doc_type) or "doc"
        public_id = f"{safe_type}_{uuid.uuid4().hex[:8]}"
        return _upload_to_cloudinary(file, folder, public_id)

    # 2. Local Fallback
    upload_root = os.environ.get('UPLOAD_FOLDER')
    if upload_root:
        base_dir = os.path.join(upload_root, 'employees', str(employee_id), 'documents')
    else:
        base_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            'uploads',
            'employees',
            str(employee_id),
            'documents'
        )
    
    os.makedirs(base_dir, exist_ok=True)
    
    # Generate safe filename
    safe_type = secure_filename(doc_type)
    if not safe_type:
        safe_type = "doc"
        
    filename = f"{safe_type}_{uuid.uuid4().hex[:8]}.{extension}"
    filepath = os.path.join(base_dir, filename)
    
    file.save(filepath)
    
    return os.path.join('employees', str(employee_id), 'documents', filename)


def save_product_image(file, product_id):
    """
    Save product image.
    If Cloudinary is configured, uploads there and returns URL.
    Otherwise, saves locally under uploads/products/{product_id}/.
    """
    if not file or not file.filename:
        raise ValueError("No file provided")

    if not allowed_file(file.filename):
        raise ValueError("File type not allowed.")

    if current_app.config.get('CLOUDINARY_CLOUD_NAME'):
        folder = "nady-elregal/products"
        public_id = f"product_{product_id}_{uuid.uuid4().hex[:8]}"
        return _upload_to_cloudinary(
            file,
            folder,
            public_id,
            transformation=[
                {
                    "width": 1400,
                    "height": 1400,
                    "crop": "limit",
                    "fetch_format": "auto",
                    "quality": "auto:good",
                }
            ],
        )

    extension = file.filename.rsplit('.', 1)[1].lower()

    upload_root = os.environ.get('UPLOAD_FOLDER')
    if upload_root:
        base_dir = os.path.join(upload_root, 'products', str(product_id))
    else:
        base_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            'uploads',
            'products',
            str(product_id)
        )

    os.makedirs(base_dir, exist_ok=True)

    filename = f"image_{uuid.uuid4().hex[:8]}.{extension}"
    filepath = os.path.join(base_dir, filename)

    file.save(filepath)

    return os.path.join('products', str(product_id), filename)
